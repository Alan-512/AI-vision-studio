
import { GoogleGenAI, Part, Content, FunctionDeclaration, Type } from "@google/genai";
import { ChatMessage, AppMode, SmartAsset, GenerationParams, ImageModel, AgentAction, AssetItem, AspectRatio, ImageResolution } from "../types";

// Key management
export const saveUserApiKey = (key: string) => localStorage.setItem('user_gemini_api_key', key);
export const getUserApiKey = () => localStorage.getItem('user_gemini_api_key');
export const removeUserApiKey = () => localStorage.removeItem('user_gemini_api_key');

const getAIClient = (userKey?: string) => {
    const key = userKey || getUserApiKey() || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_KEY : undefined);
    if (!key) throw new Error("API Key not found");
    return new GoogleGenAI({ apiKey: key });
};

// --- OFFICIAL FUNCTION DECLARATIONS ---
const generateImageTool: FunctionDeclaration = {
    name: 'generate_image',
    parameters: {
        type: Type.OBJECT,
        description: 'Trigger the image generation engine with specific parameters.',
        properties: {
            prompt: { type: Type.STRING, description: 'The detailed visual prompt (use the optimized version).' },
            aspectRatio: { type: Type.STRING, description: 'The aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4).', enum: Object.values(AspectRatio) },
            model: { type: Type.STRING, description: 'Model to use.', enum: Object.values(ImageModel) },
            resolution: { type: Type.STRING, description: 'Output resolution.', enum: Object.values(ImageResolution) },
            useGrounding: { type: Type.BOOLEAN, description: 'Whether to use Google Search for factual accuracy (Pro only).' },
            negativePrompt: { type: Type.STRING, description: 'What to avoid in the image.' },
            numberOfImages: { type: Type.NUMBER, description: 'How many variations to generate (1-4).' }
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
        model: 'gemini-3-flash-preview',
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
    onThoughtSignatures?: (signatures: Array<{ partIndex: number; signature: string }>) => void
) => {
    const ai = getAIClient();
    const isReasoning = modelName.includes('reasoning');
    const realModelName = isReasoning ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';
    const isImageMode = mode === AppMode.IMAGE;

    // HYBRID SYSTEM INSTRUCTION with Context Summary
    const contextPart = contextSummary
        ? `\n[CONVERSATION CONTEXT]\nHere is a summary of our earlier conversation:\n${contextSummary}\n\nUse this context to maintain consistency and understand references to previous work.\n`
        : '';

    const systemInstruction = `You are Lumina, the Lead Creative Director.
    ${contextPart}
    ${useSearch ? `
    [SEARCH MODE ACTIVE] 
    Since Google Search is active, you CANNOT use official tools to generate images.
    INSTEAD, if you are ready to generate, output this EXACT string at the end of your message:
    !!!GENERATE_IMAGE {"prompt": "...", "aspectRatio": "...", "model": "...", "useGrounding": true} !!!
    ` : `
    [TOOL MODE ACTIVE]
    When ready to generate, use the 'generate_image' tool.
    `}

    Always maintain the user's language. Be professional.`;

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
        config.thinkingConfig = { thinkingBudget: 4096 };
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

    for await (const chunk of result) {
        if (signal.aborted) break;

        const text = chunk.text;
        if (text) {
            fullText += text;
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

        // OFFICIAL: Handle function calls (when search is off)
        if (chunk.candidates?.[0]?.content?.parts) {
            for (const part of chunk.candidates[0].content.parts) {
                if (part.functionCall && part.functionCall.name === 'generate_image') {
                    if (onToolCall) {
                        onToolCall({ toolName: 'generate_image', args: part.functionCall.args });
                        return;
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
};

export const generateImage = async (
    params: GenerationParams,
    projectId: string,
    onStart: () => void,
    signal: AbortSignal,
    id: string
): Promise<AssetItem> => {
    onStart();
    const ai = getAIClient();
    const parts: Part[] = [];
    let processedPrompt = params.prompt;

    if (params.smartAssets && params.smartAssets.length > 0) {
        // Validate reference image count based on model
        const maxImages = params.imageModel === ImageModel.PRO ? 14 : 3;
        if (params.smartAssets.length > maxImages) {
            throw new Error(`Maximum ${maxImages} reference images allowed for ${params.imageModel}. You provided ${params.smartAssets.length}.`);
        }

        params.smartAssets.forEach((asset, idx) => {
            parts.push({ inlineData: { mimeType: asset.mimeType, data: asset.data } });
            processedPrompt += `\n- Reference image ${idx + 1} for ${asset.type} context.`;
        });
    }

    if (params.negativePrompt) processedPrompt += `\nAvoid: ${params.negativePrompt}`;
    parts.push({ text: processedPrompt });

    // FIX: Use official imageConfig format (not imageGenerationConfig)
    const config: any = {
        responseModalities: ['TEXT', 'IMAGE'],
    };

    // Add aspect ratio and resolution using official imageConfig format
    // Note: imageSize is only supported by Pro model, Flash is fixed at 1K
    const isPro = params.imageModel === ImageModel.PRO;
    if (params.aspectRatio || (isPro && params.imageResolution)) {
        config.imageConfig = {
            ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
            ...(isPro && params.imageResolution && { imageSize: params.imageResolution })
        };
    }

    if (params.imageModel === ImageModel.PRO && params.useGrounding) {
        config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
        model: params.imageModel,
        contents: { parts },
        config: { ...config, abortSignal: signal }
    });

    let imageUrl = '';
    const parts_res = response.candidates?.[0]?.content?.parts;
    if (parts_res) {
        for (const part of parts_res) {
            if (part.inlineData) {
                imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                break;
            }
        }
    }
    // Improved error handling
    if (!imageUrl) {
        const candidate = response.candidates?.[0];
        const finishReason = String(candidate?.finishReason || 'UNKNOWN');

        // Check for safety blocks
        if (finishReason === 'SAFETY' || finishReason === 'BLOCKED' || finishReason === 'BLOCKLIST') {
            throw new Error("Image blocked by safety filters. Please modify your prompt to remove potentially harmful content.");
        } else if (finishReason === 'RECITATION') {
            throw new Error("Image blocked due to copyright concerns. Please try a different prompt.");
        } else if (finishReason === 'MAX_TOKENS') {
            throw new Error("Response truncated due to token limit. Try a simpler prompt.");
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
        model: 'gemini-3-flash-preview',
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
            model: 'gemini-3-flash-preview',
            contents: `Short title for: "${prompt}". Text only.`
        });
        return (response.text ?? '').trim().replace(/^["']|["']$/g, '');
    } catch (e) {
        return prompt.slice(0, 30);
    }
};

export const testConnection = async (apiKey: string): Promise<boolean> => {
    const ai = new GoogleGenAI({ apiKey });
    await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: 'Test' });
    return true;
};

export const extractPromptFromHistory = async (history: ChatMessage[], mode: AppMode): Promise<string | null> => {
    if (history.length === 0) return null;
    const ai = getAIClient();
    const contents = convertHistoryToNativeFormat(history);
    contents.push({ role: 'user', parts: [{ text: `Based on above, output a single visual prompt for ${mode}. Text only.` }] });
    const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents });
    return (response.text ?? '').trim();
};
