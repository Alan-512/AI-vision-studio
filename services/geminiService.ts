
import { GoogleGenAI, Part, Content } from "@google/genai";
import { ChatMessage, AppMode, SmartAsset, GenerationParams, ImageModel, AgentAction, AssetItem, AspectRatio, ImageResolution, TextModel, SmartAssetRole, SearchProgress, ConsistencyProfile } from "../types";
import { createTrackedBlobUrl } from "./storageService";
import { buildSystemInstruction, getPromptOptimizerContent } from "./skills/promptRouter";
import { getAlwaysOnMemorySnippet } from "./memoryService";
import { compactConversationContext, serializeMessagesForSummary } from "./contextRuntime";
import { buildImageCriticContextText, type ImageCriticContextInput } from "./imageCriticService";
import { buildPromptWithFacts, type StructuredFact } from "./searchFactsRuntime";
import { executeInternalToolCall, normalizeSupportedToolName, runInternalToolResultLoop, stripVisibleToolPlanningText } from "./internalToolRuntime";
import { buildGoogleSearchTools, convertHistoryToNativeFormat, getRoleInstruction, resolveSmartAssetRole } from "./chatContentRuntime";
import { generateImageTool, memorySearchTool, updateMemoryTool } from "./geminiToolDeclarationRuntime";
import { buildSearchPhaseInstruction, finalizeSearchPhaseResult, SEARCH_PHASE_TIMEOUT_MS } from "./searchPhaseRuntime";
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
    const isReasoning = modelName === TextModel.PRO;
    const realModelName = isReasoning ? TextModel.PRO : TextModel.FLASH;
    console.log('[Chat] Using model:', realModelName, 'isReasoning:', isReasoning);
    const isImageMode = mode === AppMode.IMAGE;
    // Get language from localStorage for search progress UI
    const language = localStorage.getItem('app_language') || 'zh';
    const compactedContext = compactConversationContext(history, contextSummary, _summaryCursor, ROLLING_SUMMARY_RECENT_WINDOW);
    const effectiveSummary = compactedContext.effectiveSummary;
    const activeHistory = compactedContext.recentHistory;

    // HYBRID SYSTEM INSTRUCTION with Context Summary
    const contextPart = effectiveSummary
        ? `\n[CONVERSATION CONTEXT]\nHere is a summary of our earlier conversation: \n${effectiveSummary} \n\nUse this context to maintain consistency and understand references to previous work.\n`
        : '';

    // LLM_ONLY mode: LLM searches, image model does NOT use grounding
    const allowSearch = !!useSearch;
    const runLlmSearch = allowSearch;
    const searchModelName = TextModel.FLASH;

    console.log('[Chat] Search config:', { allowSearch, isImageMode, runLlmSearch });

    let searchFacts: StructuredFact[] = [];
    let searchPromptDraft = '';

    if (runLlmSearch) {
        // Add current date for time-sensitive searches
        const now = new Date();
        const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
        const dateStrEn = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const monthYearEn = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

        const searchInstruction = buildSearchPhaseInstruction({
            contextPart,
            dateStr,
            dateStrEn,
            monthYearEn
        });

        const searchContents = convertHistoryToNativeFormat(activeHistory, searchModelName);
        if (signal.aborted) throw new Error('Cancelled');

        // NOTE: Don't notify UI immediately - only show search UI when actual groundingMetadata is detected
        // This ensures the UI only appears when AI actually uses the search tool

        let searchFullText = '';
        let collectedQueries: string[] = [];
        let hasNotifiedSearchStart = false; // Track if we've shown the initial "searching" UI
        let collectedSources: Array<{ title: string; url: string }> = [];

        let searchTimeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
            // Use Flash for search collection even when the final answer uses Thinking/Pro.
            // This stage only needs grounded facts and should prefer low latency.
            const searchTimeout = new Promise<never>((_, reject) => {
                searchTimeoutId = setTimeout(() => {
                    reject(new Error(`Search phase timed out after ${SEARCH_PHASE_TIMEOUT_MS}ms`));
                }, SEARCH_PHASE_TIMEOUT_MS);
            });
            const searchResult = await Promise.race([
                ai.models.generateContentStream({
                    model: searchModelName,
                    contents: searchContents,
                    config: {
                        systemInstruction: searchInstruction,
                        // Gemini text models in this app should only use the generic googleSearch tool.
                        // Preview reasoning models currently reject imageSearch as a search subtype.
                        tools: buildGoogleSearchTools(),
                        abortSignal: signal
                    }
                }),
                searchTimeout
            ]);
            if (searchTimeoutId) {
                clearTimeout(searchTimeoutId);
            }

            for await (const chunk of searchResult) {
                if (signal.aborted) throw new Error('Cancelled');

                const chunkText = chunk.text ?? '';
                if (chunkText) {
                    searchFullText += chunkText;
                }

                // Extract groundingMetadata from chunk if available
                const candidates = (chunk as any).candidates;
                if (candidates && candidates[0]?.groundingMetadata) {
                    const gm = candidates[0].groundingMetadata;

                    // First time we detect groundingMetadata - show initial "searching" UI
                    if (!hasNotifiedSearchStart && onSearchProgress) {
                        hasNotifiedSearchStart = true;
                        onSearchProgress({
                            status: 'searching',
                            title: language === 'zh' ? '正在搜索中...' : 'Searching...',
                            queries: [],
                            sources: []
                        });
                    }

                    // Extract search queries
                    if (gm.webSearchQueries && gm.webSearchQueries.length > 0) {
                        collectedQueries = [...new Set([...collectedQueries, ...gm.webSearchQueries])];
                    }
                    // Extract sources from groundingChunks
                    if (gm.groundingChunks) {
                        for (const gc of gm.groundingChunks) {
                            if (gc.web && gc.web.uri && gc.web.title) {
                                const exists = collectedSources.some(s => s.url === gc.web.uri);
                                if (!exists) {
                                    collectedSources.push({ title: gc.web.title, url: gc.web.uri });
                                }
                            }
                        }
                    }

                    // Update UI with progress - send on every new data (streaming effect)
                    if (onSearchProgress && (collectedQueries.length > 0 || collectedSources.length > 0)) {
                        onSearchProgress({
                            status: 'searching',
                            title: language === 'zh' ? '收集关键信息' : 'Gathering key information',
                            queries: collectedQueries,
                            sources: collectedSources.slice(0, 5) // Limit to 5 sources in UI
                        });
                    }
                }
            }
        } catch (error: any) {
            if (searchTimeoutId) {
                clearTimeout(searchTimeoutId);
            }
            if (signal.aborted || error?.message === 'Cancelled' || error?.name === 'AbortError') {
                throw error;
            }
            console.warn('[Search] Search phase failed, continuing without search context.', error);
            searchFullText = '';
            collectedQueries = [];
            collectedSources = [];
        }

        if (signal.aborted) throw new Error('Cancelled');
        const finalizedSearch = finalizeSearchPhaseResult({
            searchFullText,
            collectedQueries,
            collectedSources,
            completeTitle: language === 'zh' ? '收集关键信息' : 'Gathering key information'
        });
        if (onSearchProgress && finalizedSearch.completionProgress) {
            onSearchProgress(finalizedSearch.completionProgress as any);
        }
        searchFacts = finalizedSearch.searchFacts;
        searchPromptDraft = finalizedSearch.searchPromptDraft;
    }

    // RAG: Build retrieved context section from search results
    let retrievedContextSection = '';
    if (searchFacts.length > 0 || searchPromptDraft) {
        const factsText = searchFacts.map(fact =>
            fact.source ? `• ${fact.item}: ${fact.source}` : `• ${fact.item}`
        ).join('\n');

        retrievedContextSection = `
    [RETRIEVED CONTEXT FROM SEARCH]
    The following information was retrieved from web search. Use this as your primary source of truth when responding to the user's query:
    
    ${factsText}
    ${searchPromptDraft ? `\n    Suggested visual description: ${searchPromptDraft}` : ''}
    
    IMPORTANT: When generating images, incorporate the visual details from the retrieved context above. Reference specific facts (names, appearances, colors, settings) from this search result.
    `;
    }

    // [REFACTORED] Now uses Skill system for dynamic routing (Phase 3)
    // Build dynamic instruction based on current context
    // Convert StructuredFact[] to string[] for skill system
    const searchFactsStrings = searchFacts.map(f => f.item);

    // Use full dynamic routing with userMessage for keyword matching
    const { systemInstruction: builtInstruction } = buildSystemInstruction({
        mode,
        userMessage: _newMessage, // For keyword-based skill triggering
        params: _params,
        contextSummary: effectiveSummary,
        searchFacts: searchFactsStrings,
        useSearch,
        useGrounding: _params?.useGrounding
    });

    // Get lightweight always-on memory snippet for long-term guidance
    let memorySnippet = '';
    try {
        memorySnippet = await getAlwaysOnMemorySnippet(projectId ?? null);
    } catch (e) {
        console.warn('[Memory] Failed to get memory snippet:', e);
    }

    // Inject additional context that can't be handled by the skill system
    // (these require runtime values not available at skill definition time)
    let systemInstruction = builtInstruction;
    if (contextPart) {
        systemInstruction = systemInstruction.replace(
            '[PROJECT CONTEXT]',
            `[PROJECT CONTEXT]\n${contextPart}`
        );
    }

    if (retrievedContextSection) {
        systemInstruction += `\n\n${retrievedContextSection}`;
    }

    // Inject long-term memory into system instruction
    if (memorySnippet) {
        systemInstruction += `\n\n${memorySnippet}`;
    }

    const contents = convertHistoryToNativeFormat(activeHistory, realModelName);

    const config: any = {
        systemInstruction: systemInstruction,
        tools: isImageMode
            ? [{ functionDeclarations: [generateImageTool, updateMemoryTool, memorySearchTool] }]
            : (allowSearch ? buildGoogleSearchTools() : undefined)
    };

    if (isReasoning) {
        config.thinkingConfig = {
            thinkingBudget: 4096,
            includeThoughts: true  // Enable native thinking summaries
        };
    }

    const result = await ai.models.generateContentStream({
        model: realModelName,
        contents: contents,
        config: { ...config, abortSignal: signal }
    });

    let fullText = '';
    const sourcesSet = new Set<string>();
    const sourcesList: { title: string; uri: string }[] = [];
    const collectedSignatures: Array<{ partIndex: number; signature: string }> = [];
    const pendingToolCalls: Array<{ toolName: string; args: any }> = []; // Collect tool calls, execute after stream
    const assistantTurnParts: any[] = [];

    console.log('[Stream] Starting stream loop...');
    let chunkCount = 0;
    for await (const chunk of result) {
        chunkCount++;
        if (signal.aborted) break;

        // Process parts to separate thought content from answer content
        if (chunk.candidates?.[0]?.content?.parts) {
            for (const part of chunk.candidates[0].content.parts as any[]) {
                // Handle text parts
                if (part.text) {
                    if (part.thought === true) {
                        // Native thinking summary - send to thought callback
                        if (onThoughtText) {
                            onThoughtText(part.text);
                        }
                        // Preserving thought part for history stability (Gemini 2.0 protocol)
                        assistantTurnParts.push({ text: part.text, thought: true, thoughtSignature: part.thoughtSignature });
                    } else {
                        // Regular answer text - accumulate and send to main chunk callback
                        fullText = stripVisibleToolPlanningText(fullText + part.text);
                        assistantTurnParts.push({ text: part.text, thoughtSignature: part.thoughtSignature });
                        onChunk(fullText);
                    }
                }
            }
        }

        // OFFICIAL: Handle function calls (when search is off) - DEFER execution
        if (chunk.candidates?.[0]?.content?.parts) {
            for (const part of chunk.candidates[0].content.parts) {
                // Collect function call but don't execute yet - wait for stream to complete
                if (part.functionCall) {
                    const normalizedToolName = normalizeSupportedToolName(part.functionCall.name);
                    console.log('[Stream] FunctionCall detected (deferred):', part.functionCall.name, '→', normalizedToolName);

                    if (normalizedToolName) {
                        assistantTurnParts.push({
                            functionCall: { name: normalizedToolName, args: part.functionCall.args },
                            thoughtSignature: part.thoughtSignature
                        });
                        pendingToolCalls.push({ toolName: normalizedToolName, args: part.functionCall.args });
                    }
                }
            }
        }

        // Handle Search Grounding
        const chunkAny = chunk as any;
        if (chunkAny.groundingMetadata?.groundingChunks) {
            chunkAny.groundingMetadata.groundingChunks.forEach((c: any) => {
                if (c.web?.uri && c.web?.title) {
                    if (!sourcesSet.has(c.web.uri)) {
                        sourcesSet.add(c.web.uri);
                        sourcesList.push({ title: c.web.title, uri: c.web.uri });
                    }
                }
            });
        }

        // Capture thought_signature from response parts for Gemini 3 Pro Thinking mode
        if (chunk.candidates?.[0]?.content?.parts) {
            chunk.candidates[0].content.parts.forEach((part: any, idx: number) => {
                // Capture draft images (thought images)
                if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
                    const isThought = part.thought === true;
                    if (onThoughtImage) {
                        onThoughtImage({
                            data: part.inlineData.data,
                            mimeType: part.inlineData.mimeType,
                            isFinal: !isThought
                        });
                    }
                }

                if (part.thoughtSignature && !collectedSignatures.find(s => s.signature === part.thoughtSignature)) {
                    // Use -1 for text parts, actual index for images
                    const partIndex = part.inlineData ? idx : -1;
                    collectedSignatures.push({ partIndex, signature: part.thoughtSignature });
                }
            });
        }
    }

    if (sourcesList.length > 0) {
        let sourceText = "\n\n--_\n**Sources:**\n";
        sourcesList.forEach((source, index) => {
            sourceText += `${index + 1}. [${source.title}](${source.uri})\n`;
        });
        fullText += sourceText;
        onChunk(fullText);
    }
    console.log('[Stream] Stream completed. Total chunks:', chunkCount, 'Pending tool calls:', pendingToolCalls.length);

    // Return collected thought signatures to caller for storage
    if (collectedSignatures.length > 0 && onThoughtSignatures) {
        onThoughtSignatures(collectedSignatures);
    }

    if (pendingToolCalls.length > 0 && !signal?.aborted) {
        console.log(`[Stream] Executing ${pendingToolCalls.length} deferred tool calls`);
        const preparedToolCalls: DeferredToolCall[] = pendingToolCalls.map(pendingToolCall => {
            const rawArgs = pendingToolCall.args && typeof pendingToolCall.args === 'object'
                ? pendingToolCall.args as Record<string, any>
                : {};
            const hasParametersWrapper = 'parameters' in rawArgs && typeof rawArgs.parameters === 'object';
            const targetArgs = hasParametersWrapper ? rawArgs.parameters : rawArgs;
            const existingPrompt = targetArgs.prompt;
            const basePrompt = typeof existingPrompt === 'string'
                ? existingPrompt
                : (searchPromptDraft || _newMessage);

            if (searchFacts.length > 0) {
                targetArgs.prompt = buildPromptWithFacts(basePrompt, searchFacts);
            } else if (basePrompt && !existingPrompt) {
                targetArgs.prompt = basePrompt;
            }

            targetArgs.useGrounding = false;
            return {
                toolName: pendingToolCall.toolName,
                args: hasParametersWrapper ? ({ ...rawArgs, parameters: targetArgs } as any) : targetArgs
            };
        });

        let workingContents: Content[] = assistantTurnParts.length > 0
            ? [...contents, { role: 'model', parts: assistantTurnParts } as Content]
            : [...contents];
        try {
            const internalLoopResult = await runInternalToolResultLoop({
                pendingToolCalls: preparedToolCalls,
                workingContents,
                signal,
                fullText,
                onChunk,
                executeToolCall: (toolName, args) => {
                    const rawArgs = args && typeof args === 'object' ? args : {};
                    const targetArgs = 'parameters' in rawArgs && typeof (rawArgs as any).parameters === 'object'
                        ? (rawArgs as any).parameters
                        : rawArgs;
                    return executeInternalToolCall(toolName, targetArgs, projectId);
                },
                generateFollowUpParts: async (followUpContents) => {
                    const followUpResponse = await ai.models.generateContent({
                        model: realModelName,
                        contents: followUpContents,
                        config: { ...config, abortSignal: signal }
                    });
                    return (followUpResponse as any).candidates?.[0]?.content?.parts || [];
                }
            });
            fullText = internalLoopResult.fullText;

            if (internalLoopResult.externalToolCalls.length > 0 && onToolCall && !signal.aborted) {
                for (const externalToolCall of internalLoopResult.externalToolCalls) {
                    onToolCall({ toolName: externalToolCall.toolName, args: externalToolCall.args });
                }
            }
        } catch (error) {
            console.error('[Stream] Deferred tool execution loop failed:', error);
        }
    }

    if (_onUpdateContext && compactedContext.nextSummaryRange && !signal.aborted) {
        try {
            const historyForSummary = fullText.trim()
                ? [
                    ...history,
                    { role: 'model', content: fullText, timestamp: Date.now() } as ChatMessage
                ]
                : history;
            const summarySourceSlice = historyForSummary.slice(
                compactedContext.nextSummaryRange.from,
                Math.min(compactedContext.nextSummaryRange.to, historyForSummary.length)
            );
            if (summarySourceSlice.length > 0) {
                const nextSummary = await summarizeConversationIncrementally(effectiveSummary, summarySourceSlice);
                _onUpdateContext(nextSummary, compactedContext.nextSummaryRange.to);
            }
        } catch (error) {
            console.warn('[Context] Failed to update rolling summary:', error);
        }
    }
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
    onStart();

    // DEBUG: Log edit mode params
    console.log('[generateImage] Edit mode check:', {
        hasEditBaseImage: !!params.editBaseImage,
        hasEditMask: !!params.editMask,
        editBaseImageDataLength: params.editBaseImage?.data?.length || 0,
        editMaskDataLength: params.editMask?.data?.length || 0
    });

    // DEBUG: Log key parameters for troubleshooting search grounding
    console.log('[generateImage] Called with:', {
        model: params.imageModel,
        useGrounding: params.useGrounding,
        aspectRatio: params.aspectRatio
    });

    const ai = getAIClient();
    const historyContents = history && history.length > 0
        ? convertHistoryToNativeFormat(history, params.imageModel)
        : [];

    const historyImagePrefixes = new Set<string>();
    let historyImageCount = 0;
    historyContents.forEach(content => {
        content.parts?.forEach((part: any) => {
            if (part?.inlineData?.data) {
                historyImageCount++;
                historyImagePrefixes.add(String(part.inlineData.data).slice(0, 50));
            }
        });
    });

    // Build message parts
    const parts: Part[] = [];

    // FIX: Handle Inpainting/Editing Base Images FIRST
    // usage: if editBaseImage is provided, it takes precedence as the primary context
    if (params.editBaseImage) {
        console.log('[generateImage] Using EDIT BASE image');
        parts.push({ inlineData: { mimeType: params.editBaseImage.mimeType, data: params.editBaseImage.data } });
        parts.push({ text: getRoleInstruction(SmartAssetRole.EDIT_BASE, 0) });
    }
    if (params.editMask) {
        console.log('[generateImage] Using EDIT MASK image');
        parts.push({ inlineData: { mimeType: params.editMask.mimeType, data: params.editMask.data } });
        parts.push({ text: "Mask Image (White=Edit, Black=Keep)" });
    }

    // Add reference images (user describes their usage in prompt)
    const maxImages = (params.imageModel === ImageModel.PRO || params.imageModel === ImageModel.FLASH_3_1) ? 14 : 3;
    // Count edit assets against quota
    const usedSlots = (params.editBaseImage ? 1 : 0) + (params.editMask ? 1 : 0);
    const availableSlots = Math.max(0, maxImages - historyImageCount - usedSlots);
    const smartAssets = (params.smartAssets || []).filter(asset => {
        return !historyImagePrefixes.has(asset.data.slice(0, 50));
    });
    const smartAssetsToUse = availableSlots > 0
        ? smartAssets.slice(-availableSlots)
        : [];

    // DEBUG: Log image slot calculation
    console.log('[generateImage] Image slots:', {
        maxImages,
        historyImageCount,
        availableSlots,
        smartAssetsCount: (params.smartAssets || []).length,
        filteredCount: smartAssets.length,
        toUseCount: smartAssetsToUse.length
    });

    // Add images with role hints for easy reference in prompt
    smartAssetsToUse.forEach((asset, index) => {
        console.log(`[generateImage] Adding reference image ${index + 1}:`, {
            mimeType: asset.mimeType,
            dataLength: asset.data?.length || 0,
            dataPrefix: asset.data?.slice(0, 30) || 'NO DATA'
        });
        parts.push({ inlineData: { mimeType: asset.mimeType, data: asset.data } });
        const role = resolveSmartAssetRole(asset);
        parts.push({ text: role ? getRoleInstruction(role, index) : `[Image ${index + 1}]` });
    });

    // CRITICAL DEBUG: Show total parts being sent
    console.log('[generateImage] Total parts to send:', parts.length, 'items');

    // Add user's prompt (they describe how to use the images here)
    let mainPrompt = params.prompt;

    // [Note: Time context moved to systemInstruction below for better model adherence]

    // FIX [SUP-003]: Apply imageStyle to prompt if specified
    if (params.imageStyle && params.imageStyle !== 'None') {
        mainPrompt = `[Style: ${params.imageStyle}] ${mainPrompt}`;
    }

    if (params.negativePrompt) mainPrompt += `\nAvoid: ${params.negativePrompt}`;
    parts.push({ text: mainPrompt });

    const contents: Content[] = [...historyContents, { role: 'user', parts }];

    // Build message config with imageConfig
    const isPro = params.imageModel === ImageModel.PRO;
    const isFlash31 = params.imageModel === ImageModel.FLASH_3_1;
    const messageConfig: any = {
        responseModalities: ['TEXT', 'IMAGE']
    };

    // Add time context as systemInstruction when search grounding is enabled
    // This is more effective than prepending to prompt for influencing search behavior
    if (params.useGrounding) {
        const now = new Date();
        const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
        const dateStrEn = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        messageConfig.systemInstruction = `Today is ${dateStr} (${dateStrEn}).
Use this date as temporal context for all searches — determine whether events have occurred, whether products have been released, or whether information is current.
STRICT REQUIREMENT: You MUST use the search results (googleSearch) to ground your generation.
If search results provide images, descriptions, specifications, or factual data about the subject, follow them EXACTLY.
Prioritize verified, up-to-date information and official visuals found in grounding results over your internal training data.
When generating images, strictly replicate the visual details, colors, materials, proportions, and layout found in the grounding sources.`;
    }

    if (params.aspectRatio || ((isPro || isFlash31) && params.imageResolution)) {
        // Official JS SDK uses imageConfig (not imageGenerationConfig)
        messageConfig.imageConfig = {
            ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
            ...((isPro || isFlash31) && params.imageResolution && { imageSize: params.imageResolution }),
            ...(params.numberOfImages && { numberOfImages: params.numberOfImages })
        };
    }

    if ((isPro || isFlash31) && params.useGrounding) {
        // Use camelCase for SDK compatibility at top level.
        // Native image generation on Flash can use image-aware grounding, Pro stays on web grounding.
        messageConfig.tools = buildGoogleSearchTools(isFlash31);
    }

    if (isFlash31) {
        messageConfig.thinkingConfig = {
            thinkingLevel: params.thinkingLevel || ThinkingLevel.MINIMAL,
            includeThoughts: true
        };
    }

    // Send message with unified history + current prompt
    console.log('[GeminiService] generateContent config:', JSON.stringify(messageConfig, null, 2));

    // PRE-FLIGHT ABORT CHECK: Fail fast if already cancelled
    // Note: generateContent doesn't accept AbortSignal, so we race with an abort promise
    // to return early when the user cancels (request still runs server-side).
    if (signal.aborted) throw new Error('Cancelled');

    let abortHandler: (() => void) | null = null;
    const abortPromise = new Promise<never>((_, reject) => {
        if (signal.aborted) {
            reject(new Error('Cancelled'));
            return;
        }
        abortHandler = () => reject(new Error('Cancelled'));
        signal.addEventListener('abort', abortHandler, { once: true });
    });

    let response: any;
    try {
        response = await Promise.race([
            ai.models.generateContent({
                model: params.imageModel,
                contents: contents,
                config: messageConfig
            }),
            abortPromise
        ]);
    } finally {
        if (abortHandler) {
            signal.removeEventListener('abort', abortHandler);
        }
    }

    // POST-FLIGHT ABORT CHECK: Discard result if cancelled during generation
    if (signal.aborted) throw new Error('Cancelled');

    // Process response
    console.log('[GeminiService] Full Response:', response);
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    if (groundingMetadata) {
        console.log('[GeminiService] Grounding Metadata (Search Results):', JSON.stringify(groundingMetadata, null, 2));
    }

    let imageUrl = '';
    const finishReason = String(response.candidates?.[0]?.finishReason || 'UNKNOWN');
    const collectedSignatures: Array<{ partIndex: number; signature: string }> = [];

    if (response.candidates?.[0]?.content?.parts) {
        let imagePartIndex = 0;
        for (let idx = 0; idx < (response.candidates[0].content.parts as any[]).length; idx++) {
            const part = (response.candidates[0].content.parts as any[])[idx];

            if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
                const isThought = part.thought === true;

                // Emit images via callback for UI display
                if (onThoughtImage) {
                    onThoughtImage({
                        data: part.inlineData.data,
                        mimeType: part.inlineData.mimeType,
                        isFinal: !isThought
                    });
                }

                // Use non-thought image as final result
                if (!isThought && !imageUrl) {
                    imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }

                if (part.thoughtSignature) {
                    collectedSignatures.push({ partIndex: imagePartIndex, signature: part.thoughtSignature });
                }

                imagePartIndex++;
                continue;
            }

            // Collect thoughtSignature for non-image parts (text)
            if (part.thoughtSignature) {
                collectedSignatures.push({ partIndex: -1, signature: part.thoughtSignature });
            }
        }
    }

    // Error handling with detailed logging
    if (!imageUrl) {
        // Log full response for debugging
        const candidate = response.candidates?.[0];
        const safetyRatings = candidate?.safetyRatings;
        const blockReason = (response as any).promptFeedback?.blockReason;
        const blockReasonMessage = (response as any).promptFeedback?.blockReasonMessage;

        console.error('[generateImage] No image generated. Debug info:', {
            finishReason,
            blockReason,
            blockReasonMessage,
            safetyRatings: safetyRatings?.map((r: any) => ({ category: r.category, probability: r.probability, blocked: r.blocked })),
            partsCount: candidate?.content?.parts?.length || 0,
            fullResponse: JSON.stringify(response, null, 2).slice(0, 2000) // Truncate for readability
        });

        if (finishReason === 'SAFETY' || finishReason === 'BLOCKED' || finishReason === 'BLOCKLIST') {
            const categories = safetyRatings?.filter((r: any) => r.blocked || r.probability === 'HIGH')
                .map((r: any) => r.category).join(', ') || 'unknown';
            throw new Error(`Image blocked by safety filters (${categories}). Please modify your prompt.`);
        } else if (finishReason === 'RECITATION') {
            throw new Error("Image blocked due to copyright/trademark concerns. Try describing original content instead of copyrighted characters.");
        } else if (finishReason === 'MAX_TOKENS') {
            throw new Error("Response truncated. Try a simpler prompt.");
        } else if (blockReason) {
            throw new Error(`Image blocked: ${blockReason}. ${blockReasonMessage || 'Try a different prompt.'}`);
        } else {
            throw new Error(`Image generation failed. Reason: ${finishReason}. The model did not produce an image - try rephrasing your prompt or check console for details.`);
        }
    }

    return {
        id, projectId, type: 'IMAGE', url: imageUrl, prompt: params.prompt, createdAt: Date.now(), status: 'COMPLETED',
        metadata: {
            model: params.imageModel,
            aspectRatio: params.aspectRatio,
            resolution: params.imageResolution,
            usedGrounding: params.useGrounding,
            thoughtSignatures: collectedSignatures.length > 0 ? collectedSignatures : undefined
        }
    };
};

export const generateVideo = async (
    params: GenerationParams,
    onUpdate: (opName: string) => Promise<void>,
    onStart: () => void,
    signal: AbortSignal
): Promise<{ blobUrl: string; videoUri?: string }> => {
    onStart();
    const ai = getAIClient();
    if (params.videoModel.includes('veo') && window.aistudio && !await window.aistudio.hasSelectedApiKey()) {
        await window.aistudio.openSelectKey();
    }

    const config: any = {
        numberOfVideos: 1,
        resolution: params.videoResolution as '720p' | '1080p',
        aspectRatio: params.aspectRatio === AspectRatio.PORTRAIT ? '9:16' : '16:9',
        durationSeconds: params.videoDuration || "4",
        personGeneration: 'allow_all'
    };

    let imageInput = undefined;
    if (params.videoStartImage && params.videoStartImageMimeType) {
        imageInput = { imageBytes: params.videoStartImage, mimeType: params.videoStartImageMimeType };
    }

    // FIX [SUP-003]: Apply videoStyle to prompt if specified
    let videoPrompt = params.prompt;
    if (params.videoStyle && params.videoStyle !== 'None') {
        videoPrompt = `[Style: ${params.videoStyle}] ${videoPrompt}`;
    }

    // FIX [SUP-003 v2]: Add referenceImages to config with referenceType per Veo API
    if (params.videoStyleReferences && params.videoStyleReferences.length > 0) {
        config.referenceImages = params.videoStyleReferences.map(ref => ({
            image: { imageBytes: ref.data, mimeType: ref.mimeType },
            referenceType: 'ASSET' // Required: "ASSET" for subject consistency (uppercase per SDK)
        }));
    }

    // FIX [SUP-003 v2]: Add lastFrame to config per Veo API (not as top-level param)
    if (params.videoEndImage && params.videoEndImageMimeType) {
        config.lastFrame = { imageBytes: params.videoEndImage, mimeType: params.videoEndImageMimeType };
    }

    // Build generateVideos request
    const generateRequest: any = {
        model: params.videoModel,
        prompt: videoPrompt,
        image: imageInput,
        config: config
    };

    // FIX: Add video extension support using inputVideoUri
    if (params.inputVideoUri) {
        generateRequest.video = { uri: params.inputVideoUri };
        // Video extension requires 720p resolution
        config.resolution = '720p';
        console.log('[Video] Extension mode: using source video URI');
    }

    let operation = await ai.models.generateVideos(generateRequest);
    if (operation.name) { await onUpdate(operation.name); }

    // FIX [SUP-002]: Add max attempts to prevent infinite polling
    const MAX_POLL_ATTEMPTS = 60; // 60 * 5s = 5 minutes max wait
    let pollAttempts = 0;

    while (!operation.done) {
        if (signal.aborted) throw new Error("Cancelled");

        pollAttempts++;
        if (pollAttempts >= MAX_POLL_ATTEMPTS) {
            throw new Error(`Video generation timed out after ${MAX_POLL_ATTEMPTS * 5} seconds. Please try again.`);
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({ operation });
    }

    // FIX: Validate downloadLink exists
    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) {
        throw new Error("Video generation completed but no download link was returned. The video may have been blocked by safety filters.");
    }

    // FIX: Validate API key is not undefined
    const apiKey = getUserApiKey() || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_KEY : undefined);
    if (!apiKey) {
        throw new Error("API key is required to download the generated video. Please configure your API key in settings.");
    }

    const response = await fetch(`${downloadLink}&key=${apiKey}`);

    // FIX: Validate response is OK
    if (!response.ok) {
        throw new Error(`Failed to download video: HTTP ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const blobUrl = createTrackedBlobUrl(blob);

    // Return both blob URL for display and video URI for extension
    // Extract the base URI without the key parameter for storage
    const videoUri = downloadLink.split('&')[0]; // Remove key param
    return { blobUrl, videoUri };
};

export const describeImage = async (base64: string, mimeType: string): Promise<string> => {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
        model: TextModel.FLASH,
        contents: {
            parts: [
                { inlineData: { mimeType, data: base64 } },
                { text: "Describe this image in detail." }
            ]
        }
    });
    return (response.text ?? '').trim();
};

export const generateTitle = async (prompt: string): Promise<string> => {
    const ai = getAIClient();
    try {
        const response = await ai.models.generateContent({
            model: TextModel.FLASH,
            contents: `Generate a very short title (5-15 Chinese characters OR 3-6 English words MAX) that summarizes the following creative prompt. 
RULES:
- Output ONLY the title itself, nothing else.
- Do NOT output a list of options. Output exactly ONE title.
- Do NOT include quotes, numbering, or explanations.
- Keep it concise and descriptive.

Prompt: "${prompt.slice(0, 200)}"`
        });
        // Clean up any stray formatting
        let title = (response.text ?? '').trim()
            .replace(/^[\"'""'']+|[\"'""'']+$/g, '') // Remove quotes
            .replace(/^\d+\.\s*/, '') // Remove numbering like "1. "
            .split('\n')[0]; // Take only first line if multiple
        // Fallback if still too long
        if (title.length > 30) {
            title = title.slice(0, 30);
        }
        return title || prompt.slice(0, 20);
    } catch (e) {
        return prompt.slice(0, 20);
    }
};

export const testConnection = async (apiKey: string): Promise<boolean> => {
    const ai = new GoogleGenAI({ apiKey });
    await ai.models.generateContent({ model: TextModel.FLASH, contents: 'Test' });
    return true;
};

export const extractPromptFromHistory = async (history: ChatMessage[], mode: AppMode): Promise<string | null> => {
    if (history.length === 0) return null;
    const ai = getAIClient();
    const contents = convertHistoryToNativeFormat(history, TextModel.FLASH);
    contents.push({ role: 'user', parts: [{ text: `Based on above, output a single visual prompt for ${mode}. Text only.` }] });
    const response = await ai.models.generateContent({ model: TextModel.FLASH, contents });
    return (response.text ?? '').trim();
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
    const config: any = {
        systemInstruction,
    };

    if (forceJson) {
        config.responseMimeType = "application/json";
    }

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config
        });
        return (response.text ?? '').trim();
    } catch (err) {
        console.error('[generateText] Failed:', err);
        throw err;
    }
};

