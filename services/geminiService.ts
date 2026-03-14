
import { GoogleGenAI, Part, Content, FunctionDeclaration, Type } from "@google/genai";
import { ChatMessage, AppMode, SmartAsset, GenerationParams, ImageModel, AgentAction, AssetItem, AspectRatio, ImageResolution, TextModel, AssistantMode, SmartAssetRole, SearchProgress, ThinkingLevel, StructuredCriticReview, CriticDecision, CriticIssue, CriticIssueType, RevisionPlan, ConsistencyProfile, LocalizedCriticCardCopy, CriticIssueConfidence, CriticQualityAssessment } from "../types";
import { createTrackedBlobUrl } from "./storageService";
import { buildSystemInstruction, getPromptOptimizerContent, getRoleInstruction as getSkillRoleInstruction } from "./skills/promptRouter";
import { getAlwaysOnMemorySnippet } from "./memoryService";
import { compactConversationContext, serializeMessagesForSummary } from "./contextRuntime";

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

const getAIClient = (userKey?: string) => {
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

/**
 * Structured fact from LLM search phase
 */
export interface StructuredFact {
    item: string;
    source?: string;
}

/**
 * Parse facts from LLM search phase output.
 * Expected format: { facts: [{ item, source }], promptDraft: "..." }
 */
export const parseFactsFromLLM = (llmOutput: string): { facts: StructuredFact[], promptDraft: string } => {
    try {
        // Try to parse as JSON first
        const data = JSON.parse(llmOutput);
        const facts = Array.isArray(data?.facts) ? data.facts : [];
        const promptDraft = typeof data?.promptDraft === 'string' ? data.promptDraft : '';
        return { facts, promptDraft };
    } catch {
        // If not JSON, return empty - caller should use original prompt
        console.warn('[parseFactsFromLLM] Could not parse structured facts, using empty');
        return { facts: [], promptDraft: '' };
    }
};

/**
 * Build final prompt by embedding structured facts block.
 * Facts are appended as natural language reference notes for image model.
 */
export const buildPromptWithFacts = (rawPrompt: string, factsBlock: StructuredFact[]): string => {
    if (!factsBlock || factsBlock.length === 0) return rawPrompt.trim();

    // Format facts: combine item (label) with source (detailed description)
    const factsText = factsBlock.map(fact => {
        if (fact.source) {
            return `- ${fact.item}: ${fact.source} `;
        }
        return `- ${fact.item} `;
    }).join('\n');

    return [
        rawPrompt.trim(),
        '',
        '---',
        'Reference Notes:',
        factsText
    ].join('\n');
};

const TOOL_PLANNING_JSON_MARKERS = [
    '"action"',
    '"parameters"',
    '"generate_image"',
    '"generate_video"'
];

export const stripVisibleToolPlanningText = (text: string): string => {
    if (!text) return text;

    const planningStartPatterns = [
        /\n\s*\{\s*"action"\s*:/m,
        /\n\s*```json\s*\{\s*"action"\s*:/im,
        /^\s*\{\s*"action"\s*:/m
    ];

    for (const pattern of planningStartPatterns) {
        const match = text.match(pattern);
        if (!match || typeof match.index !== 'number') continue;

        const candidate = text.slice(match.index);
        const looksLikeToolPlan = TOOL_PLANNING_JSON_MARKERS.every(marker => candidate.includes(marker))
            || (
                candidate.includes('"action"') &&
                candidate.includes('"parameters"') &&
                (candidate.includes('generate_image') || candidate.includes('generate_video'))
            );

        if (!looksLikeToolPlan) continue;

        return text.slice(0, match.index).trimEnd();
    }

    return text;
};

const resolveSmartAssetRole = (asset: SmartAsset): SmartAssetRole | null => {
    if (asset.role && Object.values(SmartAssetRole).includes(asset.role)) return asset.role;
    const legacyType = asset.type ? String(asset.type).toUpperCase() : '';
    switch (legacyType) {
        case 'STRUCTURE':
            return SmartAssetRole.COMPOSITION;
        case 'STYLE':
            return SmartAssetRole.STYLE;
        case 'SUBJECT':
            return SmartAssetRole.SUBJECT;
        case 'EDIT_BASE':
            return SmartAssetRole.EDIT_BASE;
        default:
            return null;
    }
};

// [REFACTORED] Now uses Skill system - getRoleInstruction from skills/promptRouter
const getRoleInstruction = (role: SmartAssetRole, index: number): string => {
    return getSkillRoleInstruction(role, index);
};

// --- OFFICIAL FUNCTION DECLARATIONS ---
const generateImageTool: FunctionDeclaration = {
    name: 'generate_image',
    parameters: {
        type: Type.OBJECT,
        description: 'Trigger the image generation engine with specific parameters.',
        properties: {
            prompt: {
                type: Type.STRING,
                description: `The COMPLETE visual prompt synthesized from the ENTIRE conversation.

=== REQUIRED (always include) ===
1. CONVERSATION SYNTHESIS:
   - The user's ORIGINAL intent and core subject
   - ALL refinements and agreements from the discussion
   - The FINAL consensus - integrate the FULL conversation, not just latest message

2. NARRATIVE STYLE & STRUCTURE:
   - Write flowing sentences describing the scene, NOT keyword lists.
   - Use structured templates based on intent:
     * Stylized: "A [Style] illustration of [Subject], featuring [Characteristics]..."
     * Photorealistic: "A [Shot Type] of [Subject] in [Environment] with [Lighting]..."
     * Product: "A studio-lit photograph of [Product] on [Surface]..."

3. SPECIFICITY:
   - Replace vague terms with hyper-specific details.
   - ❌ "fantasy armor" → ✅ "Ornate elven plate armor with silver leaf etchings"

4. SEMANTIC NEGATIVE:
   - Describe the *absence* of elements positively in the main prompt (e.g., "an empty, deserted street" instead of just "no cars").

=== CONTINUOUS / MULTIPLE IMAGE SEQUENCES ===
If the user requests a sequence, storyboard, or set of distinct images (e.g., "generate 4 e-commerce detail shots"):
- You MUST emit MULTIPLE, SEPARATE generate_image function calls (one for each distinct image).
- DO NOT combine different scenes into one prompt.
- For subject consistency across the sequence, you MUST set reference_mode to "ALL_USER_UPLOADED" or "USER_UPLOADED_ONLY" in EVERY distinct function call if reference images are available.

=== OPTIONAL (add only when relevant to the scene) ===
   If the image involves these aspects, include them. Otherwise, omit:
   - Shot type: wide-angle, macro, telephoto, low-angle
   - Lighting: softbox, golden hour, rim light, volumetric
   - Camera: bokeh, depth of field, shutter speed (for photorealism)
   - Mood: serene, dramatic, high-contrast
   - Textures: skin texture, fabric weave, metal sheen
   - Art style: "oil painting", "pencil sketch", "3D render"`
            },
            aspectRatio: { type: Type.STRING, description: 'Aspect ratio. Options: "1:1" (square), "16:9" (landscape), "9:16" (portrait), "4:3", "3:4", "21:9" (ultrawide). Default: "16:9"', enum: Object.values(AspectRatio) },
            model: { type: Type.STRING, description: 'Image model. Use "gemini-3.1-flash-image-preview" (nano banana 2) or "gemini-3-pro-image-preview" (pro/high quality).', enum: Object.values(ImageModel) },
            resolution: { type: Type.STRING, description: 'Output resolution. Options: "1K" (default), "2K" (Pro only), "4K" (Pro only).', enum: Object.values(ImageResolution) },
            useGrounding: { type: Type.BOOLEAN, description: 'Use Google Search for factual accuracy (Pro model only). Default: false.' },
            negativePrompt: { type: Type.STRING, description: 'What to EXCLUDE from the image. Use semantic descriptions: "blurry, low quality, distorted faces, anime style" (when user wants realism).' },
            numberOfImages: { type: Type.NUMBER, description: 'How many variations to generate (1-4). Default: 1. ONLY use > 1 when you want exact variations of the SAME prompt. For a sequence of distinct images, set to 1 and emit multiple separate function calls.' },
            assistant_mode: {
                type: Type.STRING,
                description: `Playbook mode for automatic parameter defaults:
    - CREATE_NEW: Create a new image from scratch
        - STYLE_TRANSFER: Use user - uploaded images for style guidance
            - EDIT_LAST: Modify the last AI - generated image
                - COMBINE_REFS: Combine multiple user - uploaded references
                    - PRODUCT_SHOT: Clean product photography
                        - POSTER: Poster or key visual layout`,
                enum: Object.values(AssistantMode)
            },
            override_playbook: {
                type: Type.BOOLEAN,
                description: 'Set true to bypass playbook defaults when needed for unusual or mixed intents.'
            },
            reference_image_ids: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: `Explicit IDs of images to use as reference.
- Look at the [Attached Image ID: <id>] markers in the conversation history.
- To use an image for style/subject, put its <id> here.
- For pure text-to-image (no reference needed), leave empty.
- When generating a sequence of consistent images, pass the SAME user uploaded image ID to every call.`
            },
            thinkingLevel: { type: Type.STRING, description: 'Thinking depth for Gemini 3.1 Flash Image. Options: "minimal" (speed), "high" (quality). Default: "minimal".', enum: Object.values(ThinkingLevel) }
        },
        required: [
            'prompt',
            'model',
            'aspectRatio',
            'resolution',
            'useGrounding',
            'numberOfImages',
            'negativePrompt',
            'assistant_mode',
            'thinkingLevel'
        ]
    }
};

const updateMemoryTool: FunctionDeclaration = {
    name: 'update_memory',
    description: 'Update the user\'s long-term memory (e.g. Creative Profile, Visual Preferences, Generation Defaults) based on explicit user requests or strong inferred preferences from the conversation. When the user\'s current request CONTRADICTS a stored preference, use this to OVERRIDE the old value.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            scope: { type: Type.STRING, description: 'Scope of the memory.', enum: ['global', 'project'] },
            section: { type: Type.STRING, description: 'Section to update (e.g. "Visual Preferences", "Generation Defaults", "Guardrails").' },
            key: { type: Type.STRING, description: 'The preference key to update (e.g. "preferred_style", "color_palette"). If adding to Guardrails, leave empty.' },
            value: { type: Type.STRING, description: 'The value to save for this preference.' }
        },
        required: ['scope', 'section', 'value']
    }
};

const memorySearchTool: FunctionDeclaration = {
    name: 'memory_search',
    description: 'Search user memory for relevant preferences, habits, and past decisions. Use natural language query (e.g. "what is my preferred aspect ratio?").',
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: { type: Type.STRING, description: 'Natural language search query.' },
            scope: { type: Type.STRING, description: 'Search scope.', enum: ['global', 'project', 'both'] }
        },
        required: ['query']
    }
};

const MEMORY_TOOL_NAME = 'memory_search';
const INTERNAL_TOOL_NAMES = new Set<string>([MEMORY_TOOL_NAME, 'update_memory']);
const SUPPORTED_TOOL_NAMES = new Set<string>(['generate_image', 'update_memory', MEMORY_TOOL_NAME]);
const ROLLING_SUMMARY_RECENT_WINDOW = 8;
const MAX_INTERNAL_TOOL_LOOPS = 4;

export type DeferredToolCall = {
    toolName: string;
    args: Record<string, any>;
};

type InternalToolExecutionResult = {
    response: Record<string, any>;
    fallbackText?: string;
};

export const normalizeSupportedToolName = (toolName?: string): string | null => {
    if (!toolName) return null;
    if (toolName === 'read_memory') return MEMORY_TOOL_NAME;
    return SUPPORTED_TOOL_NAMES.has(toolName) ? toolName : null;
};

const buildAssistantFunctionCallContent = (toolName: string, args: Record<string, any>): Content => ({
    role: 'model',
    parts: [{ functionCall: { name: toolName, args } } as any]
});

const buildFunctionResponseContent = (toolName: string, response: Record<string, any>): Content => ({
    role: 'user',
    parts: [{ functionResponse: { name: toolName, response } } as any]
});

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

export const executeInternalToolCall = async (
    toolName: string,
    args: Record<string, any>,
    projectId?: string | null
): Promise<InternalToolExecutionResult> => {
    if (toolName === 'update_memory') {
        const { section, key, value, scope } = args;
        if (!section || !value) {
            return {
                response: { ok: false, error: 'Missing section or value' },
                fallbackText: ''
            };
        }

        const { appendDailyLog, applyPatchToMemory } = await import('./memoryService');
        const targetScope = (scope === 'global' || scope === 'project') ? scope : 'project';
        const targetId = targetScope === 'global' ? 'default' : (projectId || 'default');

        const logId = await appendDailyLog({
            content: `${section}: ${key || ''} ${value}`.trim(),
            confidence: 1.0,
            projectId: projectId || undefined,
            scopeHint: targetScope as any,
            metadata: { source: 'ai_tool_call' }
        });

        const doc = await applyPatchToMemory(targetScope, targetId, {
            ops: [{
                op: 'upsert',
                section,
                key: key || section.toLowerCase().replace(/\s+/g, '_'),
                value
            }],
            confidence: 1.0,
            reason: 'Real-time update from AI tool call'
        });

        return {
            response: {
                ok: true,
                scope: targetScope,
                targetId,
                docVersion: doc.version,
                logId
            },
            fallbackText: `✅ 好的，我记住了：${value}`
        };
    }

    if (toolName === MEMORY_TOOL_NAME) {
        const { query, scope } = args;
        const { memorySearch } = await import('./memoryService');
        const searchResult = await memorySearch(String(query || ''), projectId, { scope });
        return {
            response: {
                ok: true,
                query: String(query || ''),
                scope: scope || 'both',
                result: searchResult
            },
            fallbackText: searchResult
        };
    }

    return { response: { ok: false, error: `Unsupported internal tool: ${toolName}` } };
};

export const runInternalToolResultLoop = async ({
    pendingToolCalls,
    workingContents,
    signal,
    fullText,
    onChunk,
    executeToolCall,
    generateFollowUpParts,
    maxInternalLoops = MAX_INTERNAL_TOOL_LOOPS
}: {
    pendingToolCalls: DeferredToolCall[];
    workingContents: Content[];
    signal: AbortSignal;
    fullText: string;
    onChunk: (text: string) => void;
    executeToolCall: (toolName: string, args: Record<string, any>) => Promise<InternalToolExecutionResult>;
    generateFollowUpParts: (contents: Content[]) => Promise<any[]>;
    maxInternalLoops?: number;
}): Promise<{ fullText: string; workingContents: Content[]; externalToolCalls: DeferredToolCall[] }> => {
    const externalToolCalls: DeferredToolCall[] = [];
    const queuedToolCalls = [...pendingToolCalls];
    let nextFullText = fullText;
    let nextContents = [...workingContents];
    let internalLoopCount = 0;

    while (queuedToolCalls.length > 0 && !signal.aborted) {
        const pendingToolCall = queuedToolCalls.shift()!;

        if (!INTERNAL_TOOL_NAMES.has(pendingToolCall.toolName)) {
            externalToolCalls.push(pendingToolCall);
            continue;
        }

        if (internalLoopCount >= maxInternalLoops) {
            console.warn('[Stream] Reached max internal tool loops, stopping follow-up tool execution');
            break;
        }

        internalLoopCount += 1;
        const { response, fallbackText } = await executeToolCall(pendingToolCall.toolName, pendingToolCall.args);
        nextContents = [
            ...nextContents,
            buildAssistantFunctionCallContent(pendingToolCall.toolName, pendingToolCall.args),
            buildFunctionResponseContent(pendingToolCall.toolName, response)
        ];

        const followUpParts = await generateFollowUpParts(nextContents);
        if (followUpParts.length > 0) {
            nextContents = [...nextContents, { role: 'model', parts: followUpParts } as Content];
        }

        let followUpText = '';
        for (const part of followUpParts) {
            if (part.text) {
                followUpText += part.text;
            }
            if (part.functionCall) {
                const nextToolName = normalizeSupportedToolName(part.functionCall.name);
                if (nextToolName) {
                    queuedToolCalls.push({
                        toolName: nextToolName,
                        args: (part.functionCall.args || {}) as Record<string, any>
                    });
                }
            }
        }

        if (followUpText.trim()) {
            const combinedText = nextFullText.trim().length > 0 ? `${nextFullText}\n${followUpText}` : followUpText;
            nextFullText = stripVisibleToolPlanningText(combinedText);
            onChunk(nextFullText);
        } else if (!nextFullText.trim() && fallbackText) {
            nextFullText = fallbackText;
            onChunk(nextFullText);
        }
    }

    return {
        fullText: nextFullText,
        workingContents: nextContents,
        externalToolCalls
    };
};


/**
 * SMART CONTEXT MANAGEMENT:
 * Keep Anchor (first) and Active (latest) images, replace rest with semantic text.
 * Also preserves thought_signature for Gemini 3 Pro Thinking mode multi-turn stability.
 */
const convertHistoryToNativeFormat = (history: ChatMessage[], modelName: string): Content[] => {
    // Determine image limit based on model (conservatively)
    // Flash: limit 3 images total. Pro: limit 5 hi-res images.
    const isFlash = modelName.includes('flash');
    const maxImages = isFlash ? 3 : 5;

    // 1. Identify which images to keep (Prioritize LATEST images)
    // We scan from end to start to find the indices of images we can keep
    let imagesKept = 0;
    const imageIndicesToKeep = new Set<string>(); // Format: "msgIndex-imgIndex"

    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        const imgCount = (msg.images?.length || 0) + (msg.image ? 1 : 0);

        if (imgCount > 0) {
            if (msg.images && msg.images.length > 0) {
                // For multiple images in one message, iterate backwards too if we want latest
                for (let j = msg.images.length - 1; j >= 0; j--) {
                    if (imagesKept < maxImages) {
                        imageIndicesToKeep.add(`${i} -${j} `);
                        imagesKept++;
                    }
                }
            } else if (msg.image) {
                if (imagesKept < maxImages) {
                    imageIndicesToKeep.add(`${i} -0`);
                    imagesKept++;
                }
            }
        }
    }

    return history.map((msg, index) => {
        const parts: Part[] = [];

        if (msg.images && msg.images.length > 0) {
            msg.images.forEach((img, imgIdx) => {
                const shouldKeep = imageIndicesToKeep.has(`${index} -${imgIdx} `);
                if (shouldKeep) {
                    const matches = img.match(/^data:(.+);base64,(.+)$/);
                    if (matches) {
                        const imgId = `${msg.role === 'user' ? 'user' : 'generated'}-${msg.timestamp}-${imgIdx}`;
                        parts.push({ text: `\n[Attached Image ID: ${imgId}]\n` });
                        const partData: any = { inlineData: { mimeType: matches[1], data: matches[2] } };
                        // Attach thought_signature if present for this part
                        const sig = msg.thoughtSignatures?.find(s => s.partIndex === imgIdx);
                        if (sig) partData.thoughtSignature = sig.signature;
                        parts.push(partData);
                    }
                } else {
                    parts.push({ text: `[Visual History: A previously generated image of ${msg.content.slice(0, 30)}...]` });
                }
            });
        } else if (msg.image) {
            const shouldKeep = imageIndicesToKeep.has(`${index} -0`);
            if (shouldKeep) {
                const matches = msg.image.match(/^data:(.+);base64,(.+)$/);
                if (matches) {
                    const imgId = `${msg.role === 'user' ? 'user' : 'generated'}-${msg.timestamp}-0`;
                    parts.push({ text: `\n[Attached Image ID: ${imgId}]\n` });
                    const partData: any = { inlineData: { mimeType: matches[1], data: matches[2] } };
                    // Attach thought_signature if present
                    const sig = msg.thoughtSignatures?.find(s => s.partIndex === 0);
                    if (sig) partData.thoughtSignature = sig.signature;
                    parts.push(partData);
                }
            } else {

                parts.push({ text: `[Visual History: Reference image provided previously.]` });
            }
        }

        if (msg.content) {
            let textContent = msg.content
                // Remove tool-related tags
                .replace(/\[Using Tool:.*?\]/g, '')
                .replace(/\[SYSTEM_FEEDBACK\]:.*?(\n|$)/g, '')
                // Remove agent orchestration tags
                .replace(/\[PROTOCOL:.*?\]/g, '')
                .replace(/\[PLANNER\]:.*?(\n|$)/g, '')
                .replace(/\.\.\. \[Orchestrator\]:.*?(\n|$)/g, '')
                // Remove text-based tool triggers
                .replace(/!!!?\s*GENERATE_IMAGE\s*\{[\s\S]*?\}\s*!!!?/g, '')
                // Remove thinking tags
                .replace(/<\s*thought\s*>[\s\S]*?<\s*\/\s*thought\s*>/gi, '')
                .replace(/<\s*thought\s*>[\s\S]*$/gi, '') // Incomplete thought tags
                .trim();
            if (textContent) {
                // Security: Add input segregation markers for user messages (OWASP prompt injection mitigation)
                const markedText = msg.role === 'user' ? `[USER INPUT]\n${textContent}\n[/USER INPUT]` : textContent;
                const textPartData: any = { text: markedText };
                // First text part after images may have signature
                const textSig = msg.thoughtSignatures?.find(s => s.partIndex === -1); // -1 = first text
                if (textSig) textPartData.thoughtSignature = textSig.signature;
                parts.push(textPartData);
            }
        }

        if (parts.length === 0) parts.push({ text: ' ' });
        const validRole = (msg.role === 'user' || msg.role === 'model') ? msg.role : 'model';
        return { role: validRole, parts: parts };
    });
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

    console.log('[Chat] Search config:', { allowSearch, isImageMode, runLlmSearch });

    let searchFacts: StructuredFact[] = [];
    let searchPromptDraft = '';

    if (runLlmSearch) {
        // Add current date for time-sensitive searches
        const now = new Date();
        const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
        const dateStrEn = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const monthYearEn = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

        const searchInstruction = `You are in SEARCH PHASE for image generation.
    ${contextPart}
    
    [CURRENT DATE]
    Today is ${dateStr} (${dateStrEn}). Use this when searching for recent/current information.
    When user asks for "recent", "this week", "latest" news, search for content from ${monthYearEn}.

    [OUTPUT FORMAT]
First, output a brief narrative in the USER'S LANGUAGE describing:
1. What you are searching for
2. Key findings from your search(visual details, character features, etc.)

Then, at the very end, output a JSON block wrapped in \`\`\`json ... \`\`\` containing:
{
  "facts": [{ "item": "label", "source": "detailed description" }],
  "promptDraft": "synthesized prompt in user's language"
}

\`\`\`json
{"facts": [...], "promptDraft": "..."}
\`\`\`

Rules:
- Use googleSearch when external facts are needed.
- Output narrative FIRST for user visibility, JSON LAST for parsing.
- If you cannot produce valid JSON, output {"facts": [], "promptDraft": ""} as fallback.
- Keep your response concise (under 400 words for narrative, 5-8 facts max).
`;

        const searchContents = convertHistoryToNativeFormat(activeHistory, realModelName);
        if (signal.aborted) throw new Error('Cancelled');

        // NOTE: Don't notify UI immediately - only show search UI when actual groundingMetadata is detected
        // This ensures the UI only appears when AI actually uses the search tool

        // Use streaming for search to show real-time progress
        const searchResult = await ai.models.generateContentStream({
            model: realModelName,
            contents: searchContents,
            config: {
                systemInstruction: searchInstruction,
                tools: [{
                    googleSearch: isReasoning ? {
                        searchTypes: {
                            webSearch: {},
                            imageSearch: {}
                        }
                    } : {}
                } as any],
                abortSignal: signal
            }
        });

        let searchFullText = '';
        let collectedQueries: string[] = [];
        let hasNotifiedSearchStart = false; // Track if we've shown the initial "searching" UI
        let collectedSources: Array<{ title: string; url: string }> = [];

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

        // Mark search as complete with final data (only if actual search was performed)
        if (onSearchProgress && collectedQueries.length > 0) {
            // Extract key results from the response for display
            const resultItems: Array<{ label: string; value: string }> = [];
            // Try to parse facts from the JSON if available
            const jsonMatch = searchFullText.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[1].trim());
                    if (parsed.facts && Array.isArray(parsed.facts)) {
                        for (const fact of parsed.facts.slice(0, 4)) {
                            resultItems.push({ label: fact.item, value: fact.source || '' });
                        }
                    }
                } catch { /* ignore parse errors */ }
            }

            onSearchProgress({
                status: 'complete',
                title: language === 'zh' ? '收集关键信息' : 'Gathering key information',
                queries: collectedQueries,
                results: resultItems.length > 0 ? resultItems : undefined,
                sources: collectedSources.slice(0, 5)
            });
        }

        if (signal.aborted) throw new Error('Cancelled');

        // Extract JSON from potential markdown code blocks
        let searchText = searchFullText.trim();
        // Remove markdown code fences if present (```json ... ``` or ``` ... ```)
        const jsonBlockMatch = searchText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonBlockMatch) {
            searchText = jsonBlockMatch[1].trim();
        }

        let parsedOk = true;
        try {
            JSON.parse(searchText);
        } catch {
            parsedOk = false;
        }

        // If JSON parse fails, continue without facts (more forgiving)
        if (!parsedOk) {
            console.warn('[Search] Could not parse search output as JSON, continuing without facts');
            // Don't return, just continue with empty facts
        }

        const parsed = parsedOk ? parseFactsFromLLM(searchText) : { facts: [], promptDraft: '' };
        searchFacts = parsed.facts;
        searchPromptDraft = parsed.promptDraft;
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
            : (allowSearch ? [{ googleSearch: {} }] : undefined)
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
        // Use camelCase for SDK compatibility at top level
        // Official docs specify googleSearch with searchTypes
        messageConfig.tools = isFlash31
            ? [{
                googleSearch: {
                    searchTypes: {
                        webSearch: {},
                        imageSearch: {}
                    }
                }
            }]
            : [{ googleSearch: {} }];
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

const VALID_CRITIC_DECISIONS = new Set<CriticDecision>(['accept', 'auto_revise', 'requires_action']);
const VALID_ISSUE_SEVERITIES = new Set(['low', 'medium', 'high']);
const VALID_ISSUE_TYPES = new Set<CriticIssueType>([
    'subject_mismatch',
    'brand_incorrect',
    'composition_weak',
    'lighting_mismatch',
    'material_weak',
    'text_artifact',
    'constraint_conflict',
    'needs_reference',
    'render_incomplete',
    'other'
]);

const sanitizeStringArray = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()).slice(0, 8)
    : [];

const sanitizeCardCopy = (value: unknown): LocalizedCriticCardCopy | undefined => {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const title = typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title.trim() : '';
    const message = typeof raw.message === 'string' && raw.message.trim().length > 0 ? raw.message.trim() : '';
    return title || message ? { title, message } : undefined;
};

const sanitizeQualityScore = (value: unknown, fallback = 3): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(5, Math.max(1, Math.round(value)));
};

const sanitizeQualityAssessment = (value: unknown): CriticQualityAssessment | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    return {
        intentAlignment: sanitizeQualityScore(raw.intentAlignment),
        compositionStrength: sanitizeQualityScore(raw.compositionStrength),
        lightingQuality: sanitizeQualityScore(raw.lightingQuality),
        materialFidelity: sanitizeQualityScore(raw.materialFidelity),
        brandAccuracy: sanitizeQualityScore(raw.brandAccuracy),
        aestheticFinish: sanitizeQualityScore(raw.aestheticFinish),
        commercialReadiness: sanitizeQualityScore(raw.commercialReadiness),
        note: typeof raw.note === 'string' && raw.note.trim().length > 0 ? raw.note.trim() : undefined
    };
};

const sanitizeRevisionPlan = (value: unknown): RevisionPlan => {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const localizedRaw = raw.localized && typeof raw.localized === 'object' ? raw.localized as Record<string, unknown> : {};
    const sanitizeLocalized = (entry: unknown) => {
        const localizedEntry = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
        const summary = typeof localizedEntry.summary === 'string' && localizedEntry.summary.trim().length > 0
            ? localizedEntry.summary.trim()
            : '';
        const preserve = sanitizeStringArray(localizedEntry.preserve);
        const adjust = sanitizeStringArray(localizedEntry.adjust);
        return summary || preserve.length > 0 || adjust.length > 0
            ? { summary, preserve, adjust }
            : undefined;
    };

    return {
        summary: typeof raw.summary === 'string' && raw.summary.trim().length > 0
            ? raw.summary.trim()
            : 'I can continue refining this result while preserving the strongest parts of the current image.',
        preserve: sanitizeStringArray(raw.preserve),
        adjust: sanitizeStringArray(raw.adjust),
        confidence: typeof raw.confidence === 'string' && VALID_ISSUE_SEVERITIES.has(raw.confidence)
            ? raw.confidence as RevisionPlan['confidence']
            : 'medium',
        executionMode: raw.executionMode === 'guided' ? 'guided' : 'auto',
        issueTypes: sanitizeStringArray(raw.issueTypes).filter((type): type is CriticIssueType => VALID_ISSUE_TYPES.has(type as CriticIssueType)),
        hardConstraints: sanitizeStringArray(raw.hardConstraints),
        preferredContinuity: sanitizeStringArray(raw.preferredContinuity),
        localized: {
            zh: sanitizeLocalized(localizedRaw.zh),
            en: sanitizeLocalized(localizedRaw.en)
        }
    };
};

const sanitizeCriticIssue = (value: unknown): CriticIssue | null => {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const type = typeof raw.type === 'string' && VALID_ISSUE_TYPES.has(raw.type as CriticIssueType)
        ? raw.type as CriticIssueType
        : 'other';
    const severity = typeof raw.severity === 'string' && VALID_ISSUE_SEVERITIES.has(raw.severity)
        ? raw.severity as CriticIssue['severity']
        : 'medium';
    const confidence = typeof raw.confidence === 'string' && VALID_ISSUE_SEVERITIES.has(raw.confidence)
        ? raw.confidence as CriticIssue['confidence']
        : 'medium';
    const title = typeof raw.title === 'string' && raw.title.trim().length > 0
        ? raw.title.trim()
        : type.replace(/_/g, ' ');
    const detail = typeof raw.detail === 'string' && raw.detail.trim().length > 0
        ? raw.detail.trim()
        : title;

    return {
        type,
        severity,
        confidence,
        autoFixable: raw.autoFixable !== false,
        title,
        detail,
        fixScope: raw.fixScope === 'local' || raw.fixScope === 'subject' || raw.fixScope === 'layout' || raw.fixScope === 'global'
            ? raw.fixScope
            : undefined,
        evidence: sanitizeStringArray(raw.evidence),
        relatedConstraint: typeof raw.relatedConstraint === 'string' && raw.relatedConstraint.trim().length > 0
            ? raw.relatedConstraint.trim()
            : undefined
    };
};

export const parseImageCriticReview = (rawText: string): StructuredCriticReview | null => {
    if (!rawText.trim()) return null;

    try {
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        const decision = typeof parsed.decision === 'string' && VALID_CRITIC_DECISIONS.has(parsed.decision as CriticDecision)
            ? parsed.decision as CriticDecision
            : 'requires_action';
        const issues = Array.isArray(parsed.issues)
            ? parsed.issues.map(sanitizeCriticIssue).filter((issue): issue is CriticIssue => !!issue)
            : [];
        const reviewPlan = sanitizeRevisionPlan(parsed.reviewPlan);

        return {
            decision,
            summary: typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
                ? parsed.summary.trim()
                : 'I reviewed the current image and prepared the next best action.',
            issues,
            quality: sanitizeQualityAssessment(parsed.quality),
            reviewPlan,
            revisedPrompt: typeof parsed.revisedPrompt === 'string' && parsed.revisedPrompt.trim().length > 0
                ? parsed.revisedPrompt.trim()
                : undefined,
            reason: typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
                ? parsed.reason.trim()
                : undefined,
            recommendedActionType: typeof parsed.recommendedActionType === 'string' && parsed.recommendedActionType.trim().length > 0
                ? parsed.recommendedActionType.trim()
                : undefined,
            userFacing: {
                zh: sanitizeCardCopy((parsed.userFacing as any)?.zh),
                en: sanitizeCardCopy((parsed.userFacing as any)?.en)
            }
        };
    } catch (error) {
        console.warn('[parseImageCriticReview] Failed to parse JSON review response', error);
        return null;
    }
};

type ParsedCriticCalibration = {
    decision: CriticDecision;
    reason?: string;
    confidence?: CriticIssueConfidence;
    recommendedActionType?: string;
    executionMode?: 'auto' | 'guided';
    userFacing?: {
        zh?: LocalizedCriticCardCopy;
        en?: LocalizedCriticCardCopy;
    };
};

export const parseImageCriticCalibration = (rawText: string): ParsedCriticCalibration | null => {
    if (!rawText.trim()) return null;

    try {
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        const decision = typeof parsed.decision === 'string' && VALID_CRITIC_DECISIONS.has(parsed.decision as CriticDecision)
            ? parsed.decision as CriticDecision
            : null;
        if (!decision) return null;

        return {
            decision,
            reason: typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
                ? parsed.reason.trim()
                : undefined,
            confidence: typeof parsed.confidence === 'string' && VALID_ISSUE_SEVERITIES.has(parsed.confidence)
                ? parsed.confidence as CriticIssueConfidence
                : undefined,
            recommendedActionType: typeof parsed.recommendedActionType === 'string' && parsed.recommendedActionType.trim().length > 0
                ? parsed.recommendedActionType.trim()
                : undefined,
            executionMode: parsed.executionMode === 'guided' ? 'guided' : (parsed.executionMode === 'auto' ? 'auto' : undefined),
            userFacing: {
                zh: sanitizeCardCopy((parsed.userFacing as any)?.zh),
                en: sanitizeCardCopy((parsed.userFacing as any)?.en)
            }
        };
    } catch (error) {
        console.warn('[parseImageCriticCalibration] Failed to parse calibration JSON', error);
        return null;
    }
};

export const applyImageCriticCalibration = (
    review: StructuredCriticReview,
    calibration: ParsedCriticCalibration | null
): StructuredCriticReview => {
    if (!calibration) return review;

    return {
        ...review,
        decision: calibration.decision,
        reason: calibration.reason || review.reason,
        recommendedActionType: calibration.recommendedActionType || review.recommendedActionType,
        reviewPlan: {
            ...review.reviewPlan,
            executionMode: calibration.executionMode || review.reviewPlan.executionMode
        },
        userFacing: {
            zh: calibration.userFacing?.zh || review.userFacing?.zh,
            en: calibration.userFacing?.en || review.userFacing?.en
        },
        calibration: {
            baseDecision: review.decision,
            calibratedDecision: calibration.decision,
            confidence: calibration.confidence,
            reason: calibration.reason || review.reason
        }
    };
};

export type ImageCriticContextInput = {
    assistantMode?: AssistantMode;
    searchFacts?: string[];
    referenceHints?: string[];
    hardConstraints?: string[];
    preferredContinuity?: string[];
    negativePrompt?: string;
    consistencyProfile?: ConsistencyProfile;
};

export const buildImageCriticContextText = (context?: ImageCriticContextInput): string => {
    if (!context) return '';

    const lines: string[] = [];
    if (context.assistantMode) {
        lines.push(`- assistant_mode: ${context.assistantMode}`);
    }

    const mergedHardConstraints = [
        ...(context.hardConstraints || []),
        ...(context.consistencyProfile?.hardConstraints || [])
    ];
    const mergedContinuity = [
        ...(context.preferredContinuity || []),
        ...(context.consistencyProfile?.preferredContinuity || [])
    ];
    const mergedPreserve = context.consistencyProfile?.preserveSignals || [];

    if (mergedHardConstraints.length > 0) {
        lines.push('- hard_constraints:');
        mergedHardConstraints.slice(0, 8).forEach(item => lines.push(`  - ${item}`));
    }
    if (mergedContinuity.length > 0) {
        lines.push('- preferred_continuity:');
        mergedContinuity.slice(0, 8).forEach(item => lines.push(`  - ${item}`));
    }
    if (mergedPreserve.length > 0) {
        lines.push('- preserve_signals:');
        mergedPreserve.slice(0, 8).forEach(item => lines.push(`  - ${item}`));
    }
    if (context.referenceHints && context.referenceHints.length > 0) {
        lines.push('- reference_context:');
        context.referenceHints.slice(0, 8).forEach(item => lines.push(`  - ${item}`));
    }
    if (context.searchFacts && context.searchFacts.length > 0) {
        lines.push('- search_facts:');
        context.searchFacts.slice(0, 8).forEach(item => lines.push(`  - ${item}`));
    }
    if (typeof context.negativePrompt === 'string' && context.negativePrompt.trim().length > 0) {
        lines.push(`- negative_prompt_to_avoid: ${context.negativePrompt.trim()}`);
    }

    return lines.length > 0
        ? `\nAdditional runtime constraints:\n${lines.join('\n')}\n`
        : '';
};

export const reviewGeneratedImageWithAI = async (
    prompt: string,
    imageBase64: string,
    mimeType: string,
    context?: ImageCriticContextInput
): Promise<StructuredCriticReview> => {
    const ai = getAIClient();
    const criticContextText = buildImageCriticContextText(context);
    const response = await ai.models.generateContent({
        model: TextModel.PRO,
        contents: {
            parts: [
                { inlineData: { mimeType, data: imageBase64 } },
                {
                    text: `You are the image critic for AI Vision Studio.

Review the generated image against the user's prompt. Your job is to decide whether the result should be accepted, automatically revised, or paused for user input.

Decision rules:
- choose "requires_action" (MANDATORY) if the user instruction is vague, subjective, or open to multiple interpretations (e.g. "make it pop", "more premium", "push it further", "give it a better vibe"). Even if you think you implemented it, you MUST let the user confirm your interpretation.
- choose "requires_action" (MANDATORY) if the revision involves a major directional shift in composition, density, or overall visual layout (e.g. from minimalist/clean to crowded/complex, or moving the main subject significantly). These large scope changes require user approval before finalizing.
- choose "auto_revise" ONLY for clear, objective fixes where the user's intent is unambiguous and the change is safely local (e.g. "remove this small artifact", "make the lighting slightly warmer").
- choose "accept" ONLY if the image matches the prompt and needs zero further refinement.
- If in doubt, ALWAYS prefer "requires_action". Never automatically "accept" a major directional change.

You must focus on practical refinement quality, not abstract art critique.
Prioritize:
1. subject / product correctness
2. composition and framing
3. lighting and material rendering
4. brand / text / artifact issues
5. consistency with a likely follow-up edit path
6. commercial finish, premium feel, and whether another revision would materially improve the result

Issue semantics:
- For "brand_incorrect", explain whether the mismatch is local label/logo fidelity, broader packaging identity, or overall brand direction drift.
- For "composition_weak", explain whether the weakness is framing, crop, balance, spacing, perspective, or layout hierarchy.
- For "material_weak", explain whether the weakness is texture realism, reflections, surface separation, edge clarity, or product finish.
- For vague or multi-interpretation requests, prefer "other" with a clear explanation of why the direction is ambiguous, and set "fixScope" to "global" if the likely change would affect the whole scene direction.
- Set "fixScope" to one of:
  - "local" for narrow fixes such as texture cleanup, lighting polish, or text cleanup
  - "subject" for subject/product identity fixes
  - "layout" for composition, crop, framing, or scene arrangement changes
  - "global" for broader direction or scene-wide shifts
- Add short "evidence" strings that describe what in the image supports your diagnosis.

Quality scoring guidance:
- 1 = clearly failing
- 3 = acceptable but not polished
- 5 = strong and production-ready
- "aestheticFinish" should reflect visual polish and premium execution within the requested style
- "commercialReadiness" should reflect whether the image is ready for real product/brand usage or still needs another meaningful pass

Return JSON only with this shape:
{
  "decision": "accept" | "auto_revise" | "requires_action",
  "summary": string,
  "reason": string,
  "recommendedActionType": string,
  "issues": [
    {
      "type": "subject_mismatch" | "brand_incorrect" | "composition_weak" | "lighting_mismatch" | "material_weak" | "text_artifact" | "constraint_conflict" | "needs_reference" | "render_incomplete" | "other",
      "severity": "low" | "medium" | "high",
      "confidence": "low" | "medium" | "high",
      "autoFixable": boolean,
      "title": string,
      "detail": string,
      "fixScope": "local" | "subject" | "layout" | "global",
      "evidence": string[],
      "relatedConstraint": string
    }
  ],
  "quality": {
    "intentAlignment": 1-5,
    "compositionStrength": 1-5,
    "lightingQuality": 1-5,
    "materialFidelity": 1-5,
    "brandAccuracy": 1-5,
    "aestheticFinish": 1-5,
    "commercialReadiness": 1-5,
    "note": string
  },
  "reviewPlan": {
    "summary": string,
    "preserve": string[],
    "adjust": string[],
    "confidence": "low" | "medium" | "high",
    "executionMode": "auto" | "guided",
    "issueTypes": string[],
    "hardConstraints": string[],
    "preferredContinuity": string[],
    "localized": {
      "zh": {
        "summary": string,
        "preserve": string[],
        "adjust": string[]
      },
      "en": {
        "summary": string,
        "preserve": string[],
        "adjust": string[]
      }
    }
  },
  "revisedPrompt": string
}

If you choose "requires_action", provide a strong plan but do not ask the user to rewrite prompts manually.

User prompt:
${prompt}${criticContextText}`
                }
            ]
        },
        config: {
            responseMimeType: 'application/json'
        }
    });

    const parsed = parseImageCriticReview((response.text ?? '').trim());
    if (!parsed) {
        throw new Error('Image critic returned invalid JSON');
    }

    try {
        const calibrationResponse = await ai.models.generateContent({
            model: TextModel.PRO,
            contents: {
                parts: [
                    {
                        text: `You are the calibration layer for AI Vision Studio's image critic.

Your job is NOT to re-review the image from scratch. Your job is to decide whether the user should actually be interrupted.

You will receive:
1. the original user prompt
2. runtime constraints
3. the primary critic's structured review JSON

Calibration rules:
- choose "requires_action" (MANDATORY) if the revision involves a directional layout/composition shift, or responds to vague terms (pop/vibe/premium).
- forbid "auto_revise" for major changes. Use it ONLY for safe, objective, local refinements where the user intent is 100% specific.
- choose "requires_action" if the change materially alters scene density, framing, or visual direction.
- prioritize safe interruption over immediate generation.
- choose "accept" only when refinement is no longer possible.
- pay special attention to compositionStrength, materialFidelity, brandAccuracy, aestheticFinish, and commercialReadiness

Return JSON only with this shape:
{
  "decision": "accept" | "auto_revise" | "requires_action",
  "reason": string,
  "confidence": "low" | "medium" | "high",
  "recommendedActionType": string,
  "executionMode": "auto" | "guided",
  "userFacing": {
    "zh": { "title": string, "message": string },
    "en": { "title": string, "message": string }
  }
}

Use action types like:
- continue_optimization
- upload_reference
- confirm_subject_direction
- confirm_brand_direction
- clarify_style_direction
- preserve_composition
- confirm_refinement_scope
- clarify_constraints

User prompt:
${prompt}${criticContextText}

Primary critic review:
${JSON.stringify(parsed, null, 2)}`
                    }
                ]
            },
            config: {
                responseMimeType: 'application/json'
            }
        });

        return applyImageCriticCalibration(parsed, parseImageCriticCalibration((calibrationResponse.text ?? '').trim()));
    } catch (error) {
        console.warn('[reviewGeneratedImageWithAI] Calibration pass failed, using primary critic review.', error);
        return parsed;
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

