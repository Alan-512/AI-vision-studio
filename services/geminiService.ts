
import { GoogleGenAI, Part, Content, FunctionDeclaration, Type, Chat } from "@google/genai";
import { ChatMessage, AppMode, SmartAsset, GenerationParams, ImageModel, AgentAction, AssetItem, AspectRatio, ImageResolution, TextModel } from "../types";

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

/**
 * Get or create an image generation chat session.
 * The session remembers all generated images and enables multi-turn editing.
 */
export const getImageChat = (projectId: string, model: ImageModel, useGrounding = false): Chat => {
    const ai = getAIClient();

    // Reset if project changed or no session exists
    if (!imageChat || imageChatProjectId !== projectId) {
        const config: any = {
            responseModalities: ['TEXT', 'IMAGE'],
        };

        // Pro model supports Google Search grounding
        if (model === ImageModel.PRO && useGrounding) {
            config.tools = [{ googleSearch: {} }];
        }

        imageChat = ai.chats.create({
            model: model, // Use the enum value directly (e.g. 'gemini-2.5-flash-image' or 'gemini-3-pro-image-preview')
            config
        });
        imageChatProjectId = projectId;
        console.log(`[ImageChat] Created new session for project: ${projectId}`);
    }

    return imageChat;
};

/**
 * Reset the image chat session (call when switching projects)
 */
export const resetImageChat = () => {
    imageChat = null;
    imageChatProjectId = null;
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
                description: `The detailed visual prompt for image generation. MUST FOLLOW THESE GUIDELINES:

1. USE NARRATIVE DESCRIPTIONS - Write flowing sentences describing the scene, NOT keyword lists.
   ❌ Bad: "cyberpunk, city, night, neon, rain"
   ✅ Good: "A rain-soaked cyberpunk cityscape at night, towering neon-lit skyscrapers reflecting off wet streets, flying vehicles in the distance..."

2. FOR REALISTIC/PHOTOGRAPHIC - Include photography terminology:
   - Shot type: close-up portrait, wide-angle shot, macro, aerial view
   - Lighting: golden hour sunlight, soft diffused studio lighting, dramatic rim lighting
   - Camera/lens: "Captured with an 85mm portrait lens with soft bokeh background"
   - Template: "A photorealistic [shot type] of [subject], [action/expression], in [environment]. Illuminated by [lighting]. Captured with [camera details]."

3. FOR ARTISTIC/ILLUSTRATED - Specify style and medium:
   - Art style: oil painting, watercolor, digital illustration, anime, 3D render
   - Artist/studio reference: "in the style of Studio Ghibli", "reminiscent of Monet"
   - Details: brush strokes, color palette, texture, mood

4. BE EXTREMELY SPECIFIC - Replace vague terms with precise descriptions:
   ❌ "fantasy armor" → ✅ "Ornate elven plate armor with silver leaf etchings, high collar, falcon-wing shaped pauldrons"

5. INTEGRATE ALL CONVERSATION POINTS - Your prompt MUST include:
   - ALL details user mentioned (colors, poses, backgrounds, objects)
   - Style elements from any reference images user provided
   - Any corrections or refinements from the conversation
   - The FINAL agreed-upon vision, not just the latest message`
            },
            aspectRatio: { type: Type.STRING, description: 'Aspect ratio. Options: "1:1" (square), "16:9" (landscape), "9:16" (portrait), "4:3", "3:4", "21:9" (ultrawide). Default: "16:9"', enum: Object.values(AspectRatio) },
            model: { type: Type.STRING, description: 'Image model. Use "gemini-2.5-flash-image" (fast, default) or "gemini-3-pro-image-preview" (pro/high quality).', enum: Object.values(ImageModel) },
            resolution: { type: Type.STRING, description: 'Output resolution. Options: "1K" (default), "2K" (Pro only), "4K" (Pro only).', enum: Object.values(ImageResolution) },
            useGrounding: { type: Type.BOOLEAN, description: 'Use Google Search for factual accuracy (Pro model only). Default: false.' },
            negativePrompt: { type: Type.STRING, description: 'What to EXCLUDE from the image. Use semantic descriptions: "blurry, low quality, distorted faces, anime style" (when user wants realism).' },
            numberOfImages: { type: Type.NUMBER, description: 'How many variations to generate (1-4). Default: 1.' }
        },
        required: ['prompt']
    }
};


/**
 * SMART CONTEXT MANAGEMENT:
 * Keep Anchor (first) and Active (latest) images, replace rest with semantic text.
 * Also preserves thought_signature for Gemini 3 Pro Thinking mode multi-turn stability.
 */
const convertHistoryToNativeFormat = (history: ChatMessage[]): Content[] => {
    return history.map((msg, index) => {
        const parts: Part[] = [];
        // IMPROVED: Keep more images in context (first 5, last 3)
        const isFirstImage = index < 5 && (msg.images?.length || msg.image);
        const isLatestImage = index >= history.length - 3;
        const shouldKeepPixels = isFirstImage || isLatestImage;

        if (msg.images && msg.images.length > 0) {
            msg.images.forEach((img, imgIdx) => {
                if (shouldKeepPixels) {
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
            if (shouldKeepPixels) {
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
    const systemPrompt = `You are a Creative Director. Refine this user prompt for ${mode} generation.
    Output ONLY the enhanced prompt string. No explanations.
    Input: "${prompt}"`;

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
    
    ${useSearch ? `
    [SEARCH MODE ACTIVE] 
    Since Google Search is active, you CANNOT use official tools to generate images.
    INSTEAD, if you are ready to generate, output this EXACT string at the end of your message:
    !!!GENERATE_IMAGE {"prompt": "...", "aspectRatio": "...", "model": "gemini-2.5-flash-image", "useGrounding": true} !!!
    ` : `
    [TOOL MODE ACTIVE]
    When ready to generate after proper consultation, use the 'generate_image' tool.
    `}`;

    const contents = convertHistoryToNativeFormat(history);

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

    for await (const chunk of result) {
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
    const response = await chat.sendMessage({
        message: parts,
        config: messageConfig
    });

    // Check for abort
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
    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    const apiKey = getUserApiKey() || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_KEY : undefined);
    const response = await fetch(`${downloadLink}&key=${apiKey}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
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
    const contents = convertHistoryToNativeFormat(history);
    contents.push({ role: 'user', parts: [{ text: `Based on above, output a single visual prompt for ${mode}. Text only.` }] });
    const response = await ai.models.generateContent({ model: TextModel.FLASH, contents });
    return (response.text ?? '').trim();
};
