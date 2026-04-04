
import { GoogleGenAI } from "@google/genai";
import { ChatMessage, AppMode, SmartAsset, GenerationParams, ImageModel, AgentAction, AssetItem, TextModel, SearchProgress, ConsistencyProfile } from "../types";
import { buildSystemInstruction, getPromptOptimizerContent } from "./skills/promptRouter";
import { getAlwaysOnMemorySnippet } from "./memoryService";
import { compactConversationContext, serializeMessagesForSummary } from "./contextRuntime";
import { buildImageCriticContextText, type ImageCriticContextInput } from "./imageCriticService";
import { executeInternalToolCall, normalizeSupportedToolName, runInternalToolResultLoop, stripVisibleToolPlanningText } from "./internalToolRuntime";
import { buildGoogleSearchTools, convertHistoryToNativeFormat, getRoleInstruction, resolveSmartAssetRole } from "./chatContentRuntime";
import { generateImageTool, memorySearchTool, updateMemoryTool } from "./geminiToolDeclarationRuntime";
import { buildSearchPhaseInstruction, executeSearchPhase, finalizeSearchPhaseResult } from "./searchPhaseRuntime";
import { executeChatStreamLoop } from "./chatStreamLoopRuntime";
import { executeDeferredChatToolCalls } from "./chatDeferredToolRuntime";
import { updateChatRollingSummary } from "./chatSummaryRuntime";
import { buildChatResponseConfig, buildRetrievedContextSection, mergeChatSystemInstruction } from "./chatInstructionRuntime";
import { generateImageWithModel, generateVideoWithModel } from "./geminiMediaRuntime";
import { executeStreamChatResponse } from "./chatResponseRuntime";
import { describeImageWithModel, extractPromptFromHistoryWithModel, generateShortTitle, generateTextWithModel, testGeminiConnection } from "./geminiUtilityRuntime";
export { stripVisibleToolPlanningText } from "./internalToolRuntime";

// Key management
export const saveUserApiKey = (key: string) => localStorage.setItem('user_gemini_api_key', key);
export const getUserApiKey = () => localStorage.getItem('user_gemini_api_key');
export const removeUserApiKey = () => localStorage.removeItem('user_gemini_api_key');

// Proxy/Network Acceleration management (for domestic direct connection)
const PROXY_STATE_KEY = 'gemini_proxy_enabled';
export const saveProxyState = (enabled: boolean) => localStorage.setItem(PROXY_STATE_KEY, enabled ? 'true' : 'false');
export const getProxyState = (): boolean => {
    const saved = localStorage.getItem(PROXY_STATE_KEY);
    // Default to disabled (false) - users can enable in settings if needed
    return saved === null ? false : saved === 'true';
};

// Default Google API base URL
const GOOGLE_API_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * Deno Deploy Proxy URL for Network Acceleration
 * 
 * This external proxy bypasses Cloudflare's 100-second timeout limit,
 * enabling long-running image generation requests (2-5 minutes) to complete.
 * 
 * Set via environment variable: VITE_PROXY_URL=https://your-project.deno.dev
 * 
 * IMPORTANT: After deploying to Deno Deploy, update this URL in:
 * 1. Local development: .env.local file
 * 2. Cloudflare Pages: Environment Variables settings
 */
const DENO_PROXY_URL = (typeof import.meta !== 'undefined'
    ? (import.meta as any).env?.VITE_PROXY_URL
    : undefined) || 'https://clear-ant-68.deno.dev';

// Helper to get the proxy base URL (must be absolute for SDK's URL constructor)
const getProxyBaseUrl = (): string => {
    // Use Deno Deploy proxy (no timeout limit) instead of Cloudflare Functions
    return DENO_PROXY_URL;
};

export const getAIClient = (userKey?: string) => {
    const key = userKey || getUserApiKey() || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_KEY : undefined);
    if (!key) throw new Error("API Key not found");

    const useProxy = getProxyState();
    const baseUrl = useProxy ? getProxyBaseUrl() : GOOGLE_API_BASE_URL;

    return new GoogleGenAI({
        apiKey: key,
        httpOptions: { baseUrl }
    });
};

// --- STRUCTURED FACTS HELPERS (Two-Phase Search Architecture) ---
const ROLLING_SUMMARY_RECENT_WINDOW = 8;

const summarizeConversationIncrementally = async (
    existingSummary: string,
    historySlice: ChatMessage[]
): Promise<string> => {
    if (historySlice.length === 0) return existingSummary.trim();

    const serializedMessages = serializeMessagesForSummary(historySlice);
    const systemInstruction = `You maintain a rolling conversation summary for an AI creative workspace.
Update the summary so it preserves stable user intent, active references, constraints, project decisions, and unfinished tasks.
Keep it concise and factual. Prefer bullet-style prose without markdown bullets.
Do not repeat low-value chatter or transient UI/system noise.`;

    const prompt = `Existing summary:
${existingSummary || '(none)'}

New conversation span:
${serializedMessages}

Return the updated rolling summary only.`;

    return generateText(systemInstruction, prompt, false, TextModel.FLASH);
};



export const optimizePrompt = async (prompt: string, mode: AppMode, _smartAssets?: SmartAsset[]): Promise<string> => {
    const ai = getAIClient();

    // [REFACTORED] Now uses Skill system for prompt optimization
    const basePrompt = getPromptOptimizerContent(mode);
    const systemPrompt = `${basePrompt}

User prompt: "${prompt}"`;

    const response = await ai.models.generateContent({
        model: TextModel.FLASH,
        contents: systemPrompt
    });
    return (response.text ?? '').trim().replace(/^"|"$/g, '');
};

export const streamChatResponse = async (
    history: ChatMessage[],
    _newMessage: string,
    onChunk: (text: string) => void,
    modelName: string,
    mode: AppMode,
    signal: AbortSignal,
    contextSummary?: string,
    _summaryCursor?: number,
    _onUpdateContext?: (summary: string, cursor: number) => void,
    onToolCall?: (action: AgentAction) => Promise<any> | any,
    useSearch?: boolean,
    _params?: GenerationParams,
    _agentContextAssets?: SmartAsset[],
    onThoughtSignatures?: (signatures: Array<{ partIndex: number; signature: string }>) => void,
    onThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void,
    onThoughtText?: (text: string) => void,  // Callback for thinking process text
    onSearchProgress?: (progress: SearchProgress) => void,  // NEW: Structured search progress callback
    projectId?: string | null  // For memory injection
) => {
    const ai = getAIClient();
    return executeStreamChatResponse({
        ai,
        history,
        newMessage: _newMessage,
        onChunk,
        modelName,
        mode,
        signal,
        contextSummary,
        summaryCursor: _summaryCursor,
        onUpdateContext: _onUpdateContext,
        onToolCall,
        useSearch,
        params: _params,
        agentContextAssets: _agentContextAssets,
        onThoughtSignatures,
        onThoughtImage,
        onThoughtText,
        onSearchProgress,
        projectId,
        compactConversationContext,
        buildSystemInstruction,
        getAlwaysOnMemorySnippet,
        convertHistoryToNativeFormat,
        buildGoogleSearchTools,
        buildSearchPhaseInstruction,
        executeSearchPhase,
        finalizeSearchPhaseResult,
        buildRetrievedContextSection,
        mergeChatSystemInstruction,
        buildChatResponseConfig,
        executeChatStreamLoop,
        executeDeferredChatToolCalls: (input: any) => executeDeferredChatToolCalls({
            ...input,
            runInternalToolResultLoopImpl: runInternalToolResultLoop,
            executeInternalToolCallImpl: executeInternalToolCall
        }),
        updateChatRollingSummary,
        normalizeSupportedToolName,
        stripVisibleToolPlanningText,
        summarizeConversation: summarizeConversationIncrementally,
        imageTools: [{ functionDeclarations: [generateImageTool, updateMemoryTool, memorySearchTool] }]
    });
};

export const generateImage = async (
    params: GenerationParams,
    projectId: string,
    onStart: () => void,
    signal: AbortSignal,
    id: string,
    history?: ChatMessage[],
    onThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void
): Promise<AssetItem> => {
    const ai = getAIClient();
    return generateImageWithModel({
        ai,
        params,
        projectId,
        onStart,
        signal,
        id,
        history,
        onThoughtImage,
        convertHistoryToNativeFormat,
        buildGoogleSearchTools,
        getRoleInstruction,
        resolveSmartAssetRole
    });
};

export const generateVideo = async (
    params: GenerationParams,
    onUpdate: (opName: string) => Promise<void>,
    onStart: () => void,
    signal: AbortSignal
): Promise<{ blobUrl: string; videoUri?: string }> => {
    const ai = getAIClient();
    return generateVideoWithModel({
        ai,
        params,
        onUpdate,
        onStart,
        signal,
        createTrackedBlobUrl,
        getApiKey: () => getUserApiKey() || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_KEY : undefined)
    });
};

export const describeImage = async (base64: string, mimeType: string): Promise<string> => {
    const ai = getAIClient();
    return describeImageWithModel({ ai, base64, mimeType });
};

export const generateTitle = async (prompt: string): Promise<string> => {
    const ai = getAIClient();
    return generateShortTitle({ ai, prompt });
};

export const testConnection = async (apiKey: string): Promise<boolean> => {
    const ai = new GoogleGenAI({ apiKey });
    return testGeminiConnection({ ai });
};

export const extractPromptFromHistory = async (history: ChatMessage[], mode: AppMode): Promise<string | null> => {
    const ai = getAIClient();
    return extractPromptFromHistoryWithModel({
        ai,
        history,
        mode,
        convertHistoryToNativeFormat
    });
};

/**
 * Utility for background tasks that require raw text or JSON generation (e.g. Memory Consolidator, Semantic Re-ranking)
 */
export const generateText = async (
    systemInstruction: string,
    prompt: string,
    forceJson: boolean = false,
    modelName: TextModel = TextModel.FLASH
): Promise<string> => {
    const ai = getAIClient();
    try {
        return generateTextWithModel({
            ai,
            systemInstruction,
            prompt,
            forceJson,
            modelName
        });
    } catch (err) {
        console.error('[generateText] Failed:', err);
        throw err;
    }
};

