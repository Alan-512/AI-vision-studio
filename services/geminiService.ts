
import { GoogleGenAI, Part, Content, FunctionDeclaration, Type, Chat } from "@google/genai";
import { ChatMessage, AppMode, SmartAsset, GenerationParams, ImageModel, AgentAction, AssetItem, AspectRatio, ImageResolution, TextModel } from "../types";
import { createTrackedBlobUrl } from "./storageService";

// Key management
export const saveUserApiKey = (key: string) => localStorage.setItem('user_gemini_api_key', key);
export const getUserApiKey = () => localStorage.getItem('user_gemini_api_key');
export const removeUserApiKey = () => localStorage.removeItem('user_gemini_api_key');

const getAIClient = (userKey?: string) => {
    const key = userKey || getUserApiKey() || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_KEY : undefined);
    if (!key) throw new Error("API Key not found");
    return new GoogleGenAI({ apiKey: key });
};

// --- MULTI-TURN IMAGE CHAT SESSION ---
// Manages a persistent chat session for image generation with automatic context
let imageChat: Chat | null = null;
let imageChatProjectId: string | null = null;
let imageChatModel: ImageModel | null = null;
let imageChatGrounding: boolean = false;

/**
 * Get or create an image generation chat session.
 * The session remembers all generated images and enables multi-turn editing.
 * Session is rebuilt when project, model, or grounding setting changes.
 */
export const getImageChat = (projectId: string, model: ImageModel, useGrounding = false): Chat => {
    const ai = getAIClient();

    // Reset if project, model, or grounding changed - or no session exists
    const needsRebuild = !imageChat ||
        imageChatProjectId !== projectId ||
        imageChatModel !== model ||
        imageChatGrounding !== useGrounding;

    if (needsRebuild) {
        const config: any = {
            responseModalities: ['TEXT', 'IMAGE'],
        };

        // Pro model supports Google Search grounding
        if (model === ImageModel.PRO && useGrounding) {
            config.tools = [{ googleSearch: {} }];
        }

        imageChat = ai.chats.create({
            model: model,
            config
        });

        // Track current session params
        imageChatProjectId = projectId;
        imageChatModel = model;
        imageChatGrounding = useGrounding;

        console.log(`[ImageChat] Created new session - project: ${projectId}, model: ${model}, grounding: ${useGrounding}`);
    }

    return imageChat!;
};

/**
 * Reset the image chat session (call when switching projects)
 */
export const resetImageChat = () => {
    imageChat = null;
    imageChatProjectId = null;
    imageChatModel = null;
    imageChatGrounding = false;
    console.log('[ImageChat] Session reset');
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

2. NARRATIVE STYLE:
   - Write flowing sentences describing the scene, NOT keyword lists
   ❌ "cyberpunk, city, night, neon" → ✅ "A rain-soaked cyberpunk cityscape at night..."

3. SPECIFICITY:
   - Replace vague terms with precise descriptions
   ❌ "fantasy armor" → ✅ "Ornate elven plate armor with silver leaf etchings"

=== OPTIONAL (add only when relevant to the scene) ===
If the image involves these aspects, include them. Otherwise, omit:
- Shot type: close-up, wide-angle, aerial view, macro (for photos/realistic)
- Lighting: golden hour, soft diffused, dramatic rim (when lighting matters)
- Camera/lens: "85mm portrait lens with bokeh" (for photorealistic only)
- Mood/atmosphere: serene, dramatic, warm (when setting a tone)
- Textures: skin texture, fabric weave, metal sheen (when materials are important)
- Art style: "oil painting style", "Studio Ghibli anime" (for illustrated/stylized)`
            },
            aspectRatio: { type: Type.STRING, description: 'Aspect ratio. Options: "1:1" (square), "16:9" (landscape), "9:16" (portrait), "4:3", "3:4", "21:9" (ultrawide). Default: "16:9"', enum: Object.values(AspectRatio) },
            model: { type: Type.STRING, description: 'Image model. Use "gemini-2.5-flash-image" (fast, default) or "gemini-3-pro-image-preview" (pro/high quality).', enum: Object.values(ImageModel) },
            resolution: { type: Type.STRING, description: 'Output resolution. Options: "1K" (default), "2K" (Pro only), "4K" (Pro only).', enum: Object.values(ImageResolution) },
            useGrounding: { type: Type.BOOLEAN, description: 'Use Google Search for factual accuracy (Pro model only). Default: false.' },
            negativePrompt: { type: Type.STRING, description: 'What to EXCLUDE from the image. Use semantic descriptions: "blurry, low quality, distorted faces, anime style" (when user wants realism).' },
            numberOfImages: { type: Type.NUMBER, description: 'How many variations to generate (1-4). Default: 1.' },
            reference_mode: {
                type: Type.STRING,
                description: `How to handle reference images from conversation history:
- NONE: No reference images (pure text-to-image)
- USER_UPLOADED_ONLY: Only use images the USER uploaded (ignore AI-generated ones) - Use when user says "regenerate", "try again", "not satisfied"
- LAST_GENERATED: Use the most recent AI-generated image - Use when user wants to EDIT/MODIFY the last result
- ALL_USER_UPLOADED: Use ALL images the user uploaded in this conversation
- LAST_N: Use the last N images (set reference_count)
Default: NONE for new generations, USER_UPLOADED_ONLY when regenerating.`,
                enum: ['NONE', 'USER_UPLOADED_ONLY', 'LAST_GENERATED', 'ALL_USER_UPLOADED', 'LAST_N']
            },
            reference_count: { type: Type.NUMBER, description: 'Only for LAST_N mode: how many recent images to use. Default: 1.' }
        },
        required: ['prompt']
    }
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
                        imageIndicesToKeep.add(`${i}-${j}`);
                        imagesKept++;
                    }
                }
            } else if (msg.image) {
                if (imagesKept < maxImages) {
                    imageIndicesToKeep.add(`${i}-0`);
                    imagesKept++;
                }
            }
        }
    }

    return history.map((msg, index) => {
        const parts: Part[] = [];

        if (msg.images && msg.images.length > 0) {
            msg.images.forEach((img, imgIdx) => {
                const shouldKeep = imageIndicesToKeep.has(`${index}-${imgIdx}`);
                if (shouldKeep) {
                    const matches = img.match(/^data:(.+);base64,(.+)$/);
                    if (matches) {
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
            const shouldKeep = imageIndicesToKeep.has(`${index}-0`);
            if (shouldKeep) {
                const matches = msg.image.match(/^data:(.+);base64,(.+)$/);
                if (matches) {
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
                const textPartData: any = { text: textContent };
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
    const isVideo = mode === AppMode.VIDEO;

    const systemPrompt = isVideo ? `
You are a professional video prompt optimizer for Veo 3.1.

CRITICAL RULES:
1. PRESERVE the user's original subject, intent, and core idea EXACTLY
2. DO NOT add new subjects, characters, or change the main theme
3. ONLY enhance with: camera movement, composition, mood, sound design

ENHANCEMENT STRUCTURE (add missing elements):
- Subject: Keep original, add detail if vague
- Action: Specify motion if implied
- Style: Add cinematic style (sci-fi, noir, documentary) if appropriate
- Camera: Add camera movement (tracking shot, aerial, dolly zoom)
- Composition: Specify shot type (wide-angle, close-up, POV)
- Mood: Add lighting/color tone (warm golden hour, cool blue tones)
- Audio: Add sound design ("footsteps echo", "wind howls")

OUTPUT: Enhanced prompt in the user's original language, with technical terms in English.
Keep concise but descriptive. Output ONLY the enhanced prompt, no explanations.

User prompt: "${prompt}"
` : `
You are a professional image prompt optimizer for Gemini Image.

CRITICAL RULES:
1. PRESERVE the user's original subject, intent, and core idea EXACTLY
2. DO NOT add new subjects, characters, or change the main theme
3. ONLY enhance with: lighting, composition, textures, atmosphere

ENHANCEMENT STRUCTURE:
- Shot type: close-up, wide-angle, aerial view, macro
- Subject: Keep original, add vivid details
- Environment: Expand setting description
- Lighting: golden hour, soft diffused, dramatic rim lighting
- Camera: lens type, bokeh, depth of field
- Mood: atmosphere description
- Textures: surface details, materials

OUTPUT: Enhanced prompt in the user's original language, with photography terms in English.
Use narrative description, not keyword lists. Output ONLY the enhanced prompt, no explanations.

User prompt: "${prompt}"
`;

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
    onToolCall?: (action: AgentAction) => void,
    useSearch?: boolean,
    _params?: GenerationParams,
    _agentContextAssets?: SmartAsset[],
    onThoughtSignatures?: (signatures: Array<{ partIndex: number; signature: string }>) => void,
    onThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void,
    onThoughtText?: (text: string) => void  // NEW: Callback for thinking process text
) => {
    const ai = getAIClient();
    const isReasoning = modelName === TextModel.PRO;
    const realModelName = isReasoning ? TextModel.PRO : TextModel.FLASH;
    console.log('[Chat] Using model:', realModelName, 'isReasoning:', isReasoning);
    const isImageMode = mode === AppMode.IMAGE;

    // HYBRID SYSTEM INSTRUCTION with Context Summary
    const contextPart = contextSummary
        ? `\n[CONVERSATION CONTEXT]\nHere is a summary of our earlier conversation:\n${contextSummary}\n\nUse this context to maintain consistency and understand references to previous work.\n`
        : '';

    const systemInstruction = `You are Lumina, the Lead Creative Director at a professional AI image generation studio.
    ${contextPart}
    
    [YOUR WORKFLOW]
    1. UNDERSTAND: Carefully analyze user's request AND any reference images they provide
       - If they upload reference images, study them closely (style, composition, colors, subjects)
       - Identify their INTENT: style transformation, modification, recreation, or new creation?
    
    2. CLARIFY (for complex/ambiguous requests):
       - If the request involves style choices (anime vs realistic, 2D vs 3D), ASK before generating
       - If reference images conflict with text description, ASK which to prioritize
       - If multiple interpretations exist, briefly present options and ask preference
       - NEVER assume style - if user uploads realistic photo, don't convert to anime unless asked
    
    3. CONFIRM (for significant generations):
       - Present your creative plan: "Based on your request, I'll create [description]. Key elements: [list]. Proceed?"
       - For simple, clear requests (e.g., "draw a cat"), you may generate directly
    
    4. GENERATE: Only call the tool when you have clear understanding
       - Use reference image style EXACTLY unless explicitly asked to change it
       - Include all user-specified elements
    
    [CRITICAL RULES]
    - Reference images are STYLE GUIDES - preserve their visual style unless told otherwise
    - When user says "参照原图" or "like the reference", match that style precisely
    - Always respond in the user's language
    - Be concise but thorough in your creative consultation
    
    [GENERATION DEFAULTS - Use these unless user specifies otherwise]
    - model: "gemini-2.5-flash-image" (fast mode, good quality)
    - model: "gemini-3-pro-image-preview" (ONLY when user explicitly asks for "pro", "high quality", "专业", "高质量")
    - aspectRatio: "16:9" (landscape default, or match user's request/reference image)
    - resolution: "1K" (default), use "2K" or "4K" only with pro model when user asks for high resolution
    - numberOfImages: 1 (unless user asks for multiple)
    - useGrounding: false (set true only when user needs real-world facts/current events)
    
    [REFERENCE MODE SELECTION - Critical for multi-turn editing]
    Choose reference_mode based on user intent:
    - "NONE": Pure text-to-image, no references needed (user says "生成/create a new...")
    - "USER_UPLOADED_ONLY": User uploaded reference images AND says "不满意/regenerate/try again/换一个" 
      → Keep original references, ignore AI-generated results
    - "LAST_GENERATED": User wants to EDIT the previous result (says "把这张图改成/modify this/change the background")
      → Use the last AI-generated image as base
    - "ALL_USER_UPLOADED": User wants to combine multiple uploaded references
    - "LAST_N": Use with reference_count when user refers to "last few images"
    
    ${useSearch ? `
    [SEARCH MODE ACTIVE] 
    Since Google Search is active, you CANNOT use official tools to generate images.
    INSTEAD, if you are ready to generate, output this EXACT string at the end of your message:
    !!!GENERATE_IMAGE {"prompt": "...", "aspectRatio": "...", "useGrounding": true} !!!
    ` : `
    [TOOL MODE ACTIVE]
    When ready to generate after proper consultation, use the 'generate_image' tool.
    `}`;

    const contents = convertHistoryToNativeFormat(history, realModelName);

    /**
     * CRITICAL FIX: Gemini does not support combining googleSearch and functionDeclarations.
     * We MUST choose only one tool type.
     */
    const config: any = {
        systemInstruction: systemInstruction,
        tools: useSearch
            ? [{ googleSearch: {} }]
            : (isImageMode ? [{ functionDeclarations: [generateImageTool] }] : undefined)
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
    let pendingToolCall: { toolName: string; args: any } | null = null; // Collect tool call, execute after stream

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
                    } else {
                        // Regular answer text - accumulate and send to main chunk callback
                        fullText += part.text;
                        onChunk(fullText);

                        // FALLBACK: Detect text-based trigger when search is on
                        const toolRegex = /!!!\s*GENERATE_IMAGE\s*(\{.*?\})\s*!!!/s;
                        const match = fullText.match(toolRegex);
                        if (match && onToolCall) {
                            try {
                                const args = JSON.parse(match[1]);
                                onToolCall({ toolName: 'generate_image', args });
                                return; // Stop stream after tool detected
                            } catch (e) { console.error("JSON parse failed in fallback trigger", e); }
                        }
                    }
                }
            }
        }

        // OFFICIAL: Handle function calls (when search is off) - DEFER execution
        if (chunk.candidates?.[0]?.content?.parts) {
            for (const part of chunk.candidates[0].content.parts) {
                // Collect function call but don't execute yet - wait for stream to complete
                if (part.functionCall) {
                    console.log('[Stream] FunctionCall detected (deferred):', part.functionCall.name);
                    if (part.functionCall.name === 'generate_image') {
                        pendingToolCall = { toolName: 'generate_image', args: part.functionCall.args };
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
    console.log('[Stream] Stream completed. Total chunks:', chunkCount, 'Has pending tool call:', !!pendingToolCall);

    // Return collected thought signatures to caller for storage
    if (collectedSignatures.length > 0 && onThoughtSignatures) {
        onThoughtSignatures(collectedSignatures);
    }

    // DEFERRED TOOL CALL: Execute after stream completes so AI response is fully shown
    if (pendingToolCall && onToolCall) {
        console.log('[Stream] Executing deferred tool call:', pendingToolCall.toolName);
        onToolCall(pendingToolCall);
    }
};

export const generateImage = async (
    params: GenerationParams,
    projectId: string,
    onStart: () => void,
    signal: AbortSignal,
    id: string,
    onThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void
): Promise<AssetItem> => {
    onStart();

    // Build message parts
    const parts: Part[] = [];

    // Add reference images first (user describes their usage in prompt)
    if (params.smartAssets && params.smartAssets.length > 0) {
        const maxImages = params.imageModel === ImageModel.PRO ? 14 : 3;
        if (params.smartAssets.length > maxImages) {
            throw new Error(`Maximum ${maxImages} reference images allowed for ${params.imageModel}. You provided ${params.smartAssets.length}.`);
        }

        // Add images as "Image 1", "Image 2", etc. for easy reference in prompt
        params.smartAssets.forEach((asset, index) => {
            parts.push({ inlineData: { mimeType: asset.mimeType, data: asset.data } });
            parts.push({ text: `[Image ${index + 1}]` });
        });
    }

    // Add user's prompt (they describe how to use the images here)
    let mainPrompt = params.prompt;
    if (params.negativePrompt) mainPrompt += `\nAvoid: ${params.negativePrompt}`;
    parts.push({ text: mainPrompt });

    // Get or create chat session for this project
    // This enables multi-turn editing - the model remembers previous images
    const chat = getImageChat(projectId, params.imageModel, params.useGrounding);

    // Build message config with imageConfig
    const isPro = params.imageModel === ImageModel.PRO;
    const messageConfig: any = {};

    if (params.aspectRatio || (isPro && params.imageResolution)) {
        // config in sendMessage is likely GenerationConfig type (based on getImageChat usage)
        // so we put imageGenerationConfig directly at top level
        messageConfig.imageGenerationConfig = {
            ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
            ...(isPro && params.imageResolution && { imageSize: params.imageResolution })
        };
    }

    // Send message to chat session
    // The chat automatically includes context from previous turns
    console.log('[GeminiService] sendMessage config:', JSON.stringify(messageConfig, null, 2));

    // PRE-FLIGHT ABORT CHECK: Fail fast if already cancelled
    // Note: chat.sendMessage doesn't accept AbortSignal, so we race with an abort promise
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
            chat.sendMessage({
                message: parts,
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
    let imageUrl = '';
    const finishReason = String(response.candidates?.[0]?.finishReason || 'UNKNOWN');

    if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts as any[]) {
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
            }
        }
    }

    // Error handling
    if (!imageUrl) {
        if (finishReason === 'SAFETY' || finishReason === 'BLOCKED' || finishReason === 'BLOCKLIST') {
            throw new Error("Image blocked by safety filters. Please modify your prompt.");
        } else if (finishReason === 'RECITATION') {
            throw new Error("Image blocked due to copyright concerns. Try a different prompt.");
        } else if (finishReason === 'MAX_TOKENS') {
            throw new Error("Response truncated. Try a simpler prompt.");
        } else {
            throw new Error(`Image generation failed. Reason: ${finishReason}`);
        }
    }

    return {
        id, projectId, type: 'IMAGE', url: imageUrl, prompt: params.prompt, createdAt: Date.now(), status: 'COMPLETED',
        metadata: { model: params.imageModel, aspectRatio: params.aspectRatio, resolution: params.imageResolution, usedGrounding: params.useGrounding }
    };
};

export const generateVideo = async (
    params: GenerationParams,
    onUpdate: (opName: string) => Promise<void>,
    onStart: () => void,
    signal: AbortSignal
): Promise<string> => {
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

    let operation = await ai.models.generateVideos({ model: params.videoModel, prompt: params.prompt, image: imageInput, config: config });
    if (operation.name) { await onUpdate(operation.name); }
    while (!operation.done) {
        if (signal.aborted) throw new Error("Cancelled");
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
    return createTrackedBlobUrl(blob);
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
            contents: `Short title for: "${prompt}". Text only.`
        });
        return (response.text ?? '').trim().replace(/^["']|["']$/g, '');
    } catch (e) {
        return prompt.slice(0, 30);
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
