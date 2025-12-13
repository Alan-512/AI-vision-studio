import { GoogleGenAI, GenerateContentResponse, Content, Part, FunctionDeclaration, Tool as GeminiTool, FunctionCall, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, tool, CoreMessage } from 'ai';
import { z } from 'zod';
import { GenerationParams, AspectRatio, ImageResolution, VideoResolution, AssetItem, ImageModel, ImageStyle, VideoStyle, VideoDuration, VideoModel, ChatMessage, ChatModel, AppMode, SmartAsset, AgentJob, JobStep } from "../types";

const USER_API_KEY_STORAGE_KEY = 'user_gemini_api_key';

// --- TOOL CONTRACTS ---

export interface AgentAction {
  toolName: string;
  args: any;
  jobId?: string; // Link action to a job
}

export const saveUserApiKey = (key: string) => {
  localStorage.setItem(USER_API_KEY_STORAGE_KEY, key);
};

export const getUserApiKey = (): string | null => {
  return localStorage.getItem(USER_API_KEY_STORAGE_KEY);
};

export const removeUserApiKey = () => {
  localStorage.removeItem(USER_API_KEY_STORAGE_KEY);
};

// Helper to get client. Prioritizes User Key, then Env Key.
const getClient = (): GoogleGenAI => {
  const userKey = getUserApiKey();
  const envKey = process.env.API_KEY;
  
  const apiKey = userKey || envKey;

  if (!apiKey) {
    throw new Error("API Key not found. Please enter your API Key in Settings.");
  }
  return new GoogleGenAI({ apiKey });
};

// Vercel SDK Client Helper
const getVercelGoogle = () => {
    const userKey = getUserApiKey();
    const envKey = process.env.API_KEY;
    const apiKey = userKey || envKey;
    if (!apiKey) throw new Error("API Key required");
    
    return createGoogleGenerativeAI({ apiKey });
};

export const checkVeoAuth = async (): Promise<boolean> => {
  if (window.aistudio && window.aistudio.hasSelectedApiKey) {
    return await window.aistudio.hasSelectedApiKey();
  }
  return false; // Fallback if not in correct environment
};

export const promptForVeoKey = async (): Promise<void> => {
  if (window.aistudio && window.aistudio.openSelectKey) {
    await window.aistudio.openSelectKey();
  } else {
    console.warn("Veo Key Selection API not available");
  }
};

// Helper to clean up error messages
const parseError = (error: any): Error => {
  let message = "Unknown Error";
  
  if (typeof error === 'string') {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (error?.response?.data?.error?.message) {
    message = error.response.data.error.message;
  } else if (error?.error?.message) {
    message = error.error.message;
  } else {
    try {
      message = JSON.stringify(error);
    } catch {
      message = String(error);
    }
  }

  // Handle common error patterns
  if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
      return new Error("Quota Exceeded. You have reached the daily generation limit.");
  }
  
  if (message.includes('503') || message.includes('overloaded')) {
      return new Error("Model is overloaded. Please try again in a few seconds.");
  }

  return new Error(message);
};

// Helper: Make any Promise abortable using an AbortSignal
const makeAbortable = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new Error("Cancelled"));
    
    return new Promise<T>((resolve, reject) => {
        const abortHandler = () => reject(new Error("Cancelled"));
        signal.addEventListener('abort', abortHandler);
        
        promise.then(
            (val) => {
                signal.removeEventListener('abort', abortHandler);
                resolve(val);
            },
            (err) => {
                signal.removeEventListener('abort', abortHandler);
                reject(err);
            }
        );
    });
};

// --- Concurrency & Retry Logic ---

class RequestQueue {
  private queue: (() => Promise<void>)[] = [];
  private activeCount = 0;

  constructor(private maxConcurrent: number) {}

  async add<T>(task: () => Promise<T>, onStart?: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
        this.activeCount++;
        if (onStart) onStart();
        try {
          const result = await this.retry(task);
          resolve(result);
        } catch (e) {
          reject(e);
        } finally {
          this.activeCount--;
          this.next();
        }
      };

      if (this.activeCount < this.maxConcurrent) {
        wrappedTask();
      } else {
        this.queue.push(wrappedTask);
      }
    });
  }

  private next() {
    if (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      task?.();
    }
  }

  private async retry<T>(task: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
    try {
      return await task();
    } catch (error: any) {
      if (error.message === 'Cancelled' || error.name === 'AbortError') throw error;
      
      const parsedError = parseError(error);
      if (parsedError.message.includes('Quota')) throw parsedError;

      if (retries > 0) {
        await new Promise(res => setTimeout(res, delay));
        return this.retry(task, retries - 1, delay * 2);
      }
      throw parsedError;
    }
  }
}

const imageQueue = new RequestQueue(4); 
const videoQueue = new RequestQueue(1);

// --- ASSET GENERATION FUNCTIONS ---

export const testConnection = async (apiKey: string): Promise<boolean> => {
  try {
    const ai = new GoogleGenAI({ apiKey });
    await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: 'Test' });
    return true;
  } catch (e) {
    throw parseError(e);
  }
};

export const generateImage = async (
  params: GenerationParams,
  projectId: string,
  onStart?: () => void,
  signal?: AbortSignal,
  taskId?: string
): Promise<AssetItem> => {
  return imageQueue.add(async () => {
    if (signal?.aborted) throw new Error("Cancelled");
    const ai = getClient();
    
    let modelName = params.imageModel;
    const validModels: string[] = [ImageModel.FLASH, ImageModel.PRO];
    if (!validModels.includes(modelName)) modelName = ImageModel.PRO; 
    
    const parts: Part[] = [];
    if (params.smartAssets) {
        for (const asset of params.smartAssets) {
            parts.push({ inlineData: { mimeType: asset.mimeType, data: asset.data } });
        }
    }
    
    let finalPrompt = params.prompt;
    if (params.negativePrompt) finalPrompt += ` --negative_prompt="${params.negativePrompt}"`; 
    if (params.imageStyle && params.imageStyle !== ImageStyle.NONE) finalPrompt += `. Style: ${params.imageStyle}`;
    
    parts.push({ text: finalPrompt });

    const config: any = { imageConfig: { aspectRatio: params.aspectRatio } };
    if (modelName === ImageModel.PRO) {
        if (params.imageResolution) config.imageConfig.imageSize = params.imageResolution;
        if (params.useGrounding) config.tools = [{ googleSearch: {} }];
    }
    if (params.seed !== undefined) config.seed = params.seed;
    if (params.guidanceScale !== undefined) config.imageConfig.guidanceScale = params.guidanceScale;

    const response: GenerateContentResponse = await makeAbortable(ai.models.generateContent({
        model: modelName,
        contents: { parts },
        config
    }), signal);
    
    let imageUrl = '';
    let imageBase64 = '';
    let mimeType = '';

    if (response.candidates && response.candidates[0].content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                imageBase64 = part.inlineData.data;
                mimeType = part.inlineData.mimeType || 'image/png';
                imageUrl = `data:${mimeType};base64,${imageBase64}`;
                break;
            }
        }
    }

    if (!imageUrl) {
        const textPart = response.candidates?.[0]?.content?.parts?.find(p => p.text);
        if (textPart) throw new Error(`Model Refusal: ${textPart.text}`);
        throw new Error("No image generated.");
    }

    return {
        id: taskId || crypto.randomUUID(),
        projectId,
        type: 'IMAGE',
        url: imageUrl,
        prompt: params.prompt,
        createdAt: Date.now(),
        status: 'COMPLETED',
        metadata: {
            aspectRatio: params.aspectRatio,
            model: modelName,
            style: params.imageStyle,
            resolution: params.imageResolution,
            seed: params.seed,
            guidanceScale: params.guidanceScale
        }
    };
  }, onStart);
};

export const generateVideo = async (
  params: GenerationParams,
  onOperationId: (id: string) => Promise<void>,
  onStart?: () => void,
  signal?: AbortSignal
): Promise<string> => {
   return videoQueue.add(async () => {
       if (signal?.aborted) throw new Error("Cancelled");
       const ai = getClient();
       
       const config: any = {
           numberOfVideos: 1,
           resolution: params.videoResolution || VideoResolution.RES_720P,
           aspectRatio: params.aspectRatio,
       };

       const requestParams: any = {
           model: params.videoModel || VideoModel.VEO_FAST,
           prompt: params.prompt,
           config
       };

       if (params.videoStartImage) {
           requestParams.image = { imageBytes: params.videoStartImage, mimeType: params.videoStartImageMimeType || 'image/png' };
       }
       if (params.videoEndImage) {
           config.lastFrame = { imageBytes: params.videoEndImage, mimeType: params.videoEndImageMimeType || 'image/png' };
       }
       if (params.videoModel === VideoModel.VEO_HQ && params.videoStyleReferences && params.videoStyleReferences.length > 0) {
           config.referenceImages = params.videoStyleReferences.map(ref => ({
               image: { imageBytes: ref.data, mimeType: ref.mimeType },
               referenceType: 'ASSET'
           }));
       }
       
       if (onStart) onStart();
       
       let operation: any = await makeAbortable(ai.models.generateVideos(requestParams), signal);
       if (onOperationId && operation.name) await onOperationId(operation.name);

       while (!operation.done) {
           if (signal?.aborted) throw new Error("Cancelled");
           await new Promise(resolve => setTimeout(resolve, 5000));
           operation = await ai.operations.getVideosOperation({ operation });
       }
       
       if (operation.error) throw parseError(operation.error);
       
       const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
       if (!downloadLink) throw new Error("No video URI returned.");
       
       const keyToUse = getUserApiKey() || process.env.API_KEY;
       const response = await fetch(`${downloadLink}&key=${keyToUse}`);
       if (!response.ok) throw new Error("Failed to download video.");
       
       const blob = await response.blob();
       return URL.createObjectURL(blob);
   });
};

export const resumeVideoGeneration = async (operationName: string): Promise<string> => {
    return videoQueue.add(async () => {
        const ai = getClient();
        let operation: any = { name: operationName };
        
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            operation = await ai.operations.getVideosOperation({ operation: { name: operationName } });
        }

        if (operation.error) throw parseError(operation.error);

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) throw new Error("No video URI returned.");

        const keyToUse = getUserApiKey() || process.env.API_KEY;
        const response = await fetch(`${downloadLink}&key=${keyToUse}`);
        if (!response.ok) throw new Error("Failed to download video.");

        const blob = await response.blob();
        return URL.createObjectURL(blob);
    });
};

// --- UTILS ---

export const optimizePrompt = async (originalPrompt: string, mode: AppMode, smartAssets?: SmartAsset[]): Promise<string> => {
  if (!originalPrompt.trim()) return "";
  const ai = getClient();
  
  let assetContext = "";
  if (smartAssets && smartAssets.length > 0) {
      const types = smartAssets.map(a => a.type);
      assetContext = `\nCONTEXT: The user has attached ${smartAssets.length} reference images: ${types.join(', ')}.`;
  }

  const task = `You are a professional Prompt Engineer. Rewrite this prompt to be more descriptive and detailed for an AI generator. 
  ${assetContext}
  Original: "${originalPrompt}"
  Output ONLY the optimized prompt.`;
    
  try {
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: task });
    return response.text?.trim() || originalPrompt;
  } catch (e) {
    return originalPrompt;
  }
};

export const describeImage = async (base64Data: string, mimeType: string): Promise<string> => {
  const ai = getClient();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: "Describe this image in detail for a text-to-image prompt. Output ONLY the prompt." }
        ]
      }
    });
    return response.text?.trim() || "";
  } catch (e) {
    throw new Error("Failed to analyze image.");
  }
};

export const generateProjectName = async (prompt: string): Promise<string> => {
  try {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Generate a very short title (max 4 words) based on this: "${prompt}". No quotes.`,
    });
    return response.text?.trim() || "New Project";
  } catch (e) {
    return "New Project";
  }
};

export const extractPromptFromHistory = async (history: ChatMessage[], mode: AppMode = AppMode.IMAGE): Promise<string> => {
  try {
    const ai = getClient();
    const recentHistory = history.slice(-20);
    const conversationText = recentHistory.map(msg => {
        // Strip thoughts from context analysis to save tokens
        const clean = msg.content.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
        return `${msg.role}: ${clean}`;
    }).join('\n');
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Extract the final image/video generation prompt from this conversation. Output ONLY the raw prompt text.\n${conversationText}`
    });
    return response.text?.trim() || "";
  } catch (e) {
    throw new Error("Failed to summarize conversation.");
  }
};

const updateRecursiveSummary = async (currentSummary: string, newMessages: ChatMessage[]): Promise<string> => {
  if (newMessages.length === 0) return currentSummary;
  const ai = getClient();
  const deltaText = newMessages.map(m => {
      // Strip thoughts from summary
      const clean = m.content.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
      return `${m.role.toUpperCase()}: ${clean}`;
  }).join('\n');
  
  const prompt = `Update the memory summary based on new interactions. Keep it concise.\nCURRENT: ${currentSummary}\nNEW: ${deltaText}`;
  try {
     const resp = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
     return resp.text?.trim() || currentSummary;
  } catch (e) {
     return currentSummary;
  }
};

// --- DATA CONVERSION HELPERS ---

const convertHistoryToVercelFormat = (history: ChatMessage[]): CoreMessage[] => {
    return history.map(msg => {
        const parts: any[] = [];
        if (msg.images?.length) {
            msg.images.forEach(img => {
                const matches = img.match(/^data:(.+);base64,(.+)$/);
                if (matches) parts.push({ type: 'image', image: matches[2], mimeType: matches[1] });
            });
        } else if (msg.image) {
             const matches = msg.image.match(/^data:(.+);base64,(.+)$/);
             if (matches) parts.push({ type: 'image', image: matches[2], mimeType: matches[1] });
        }
        
        // Vercel/Standard Models do not need to see the "Thinking" trace of previous messages.
        // It consumes context window and can confuse the standard model.
        let textContent = msg.content || ''; 
        textContent = textContent.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
        // Also remove tool logs from history for Vercel model to avoid hallucinating them
        textContent = textContent.replace(/\[Using Tool:.*?\]/g, '').trim();
        
        if (parts.length > 0) {
            if (textContent) parts.push({ type: 'text', text: textContent });
            return { role: msg.role === 'model' ? 'assistant' : 'user', content: parts } as CoreMessage;
        } else {
            // FAILSAFE: Ensure content is never empty string, which triggers "ContentUnion is required" error in Zod
            return { role: msg.role === 'model' ? 'assistant' : 'user', content: textContent || ' ' } as CoreMessage;
        }
    });
};

const convertHistoryToNativeFormat = (history: ChatMessage[]): Content[] => {
    return history.map(msg => {
        const parts: Part[] = [];
        if (msg.images && msg.images.length > 0) {
            msg.images.forEach(img => {
                const matches = img.match(/^data:(.+);base64,(.+)$/);
                if (matches) parts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
            });
        } else if (msg.image) {
            const matches = msg.image.match(/^data:(.+);base64,(.+)$/);
            if (matches) parts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
        }
        
        if (msg.content) parts.push({ text: msg.content });
        if (parts.length === 0) parts.push({ text: ' ' }); // Failsafe
        
        // STRICT ROLE ENFORCEMENT: Only 'user' or 'model' allowed by Native SDK
        const validRole = (msg.role === 'user' || msg.role === 'model') ? msg.role : 'model';
        
        return { role: validRole, parts: parts };
    });
};

const NATIVE_IMAGE_TOOL: FunctionDeclaration = {
    name: 'generate_image',
    description: "Generate an image. IMPORTANT: For storyboards/comics/sequences, you MUST call this tool SEPARATELY for EACH panel/frame to ensure high quality. Do NOT generate multiple panels in one single tool call unless explicitly asked for a grid/collage.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            prompt: { type: Type.STRING, description: "A highly detailed, descriptive prompt." },
            numberOfImages: { type: Type.NUMBER, description: "Number of images. Default 1. Keep as 1 for sequential storyboard generation." },
            aspectRatio: { type: Type.STRING, enum: ["1:1", "16:9", "9:16", "4:3", "3:4"] },
            model: { type: Type.STRING, enum: [ImageModel.FLASH, ImageModel.PRO] },
            style: { type: Type.STRING },
            resolution: { type: Type.STRING, enum: ["1K", "2K", "4K"] },
            negativePrompt: { type: Type.STRING },
            seed: { type: Type.NUMBER },
            guidanceScale: { type: Type.NUMBER },
            // NEW: Anchoring Params
            save_as_reference: { 
                type: Type.STRING, 
                enum: ["IDENTITY", "STYLE", "NONE"],
                description: "If 'IDENTITY', creates a reusable character anchor from this result. If 'STYLE', creates a style anchor. Use this for the FIRST image in a sequence."
            },
            use_ref_context: { 
                type: Type.BOOLEAN,
                description: "If true, uses the previously saved anchor/reference images to maintain consistency. Use this for SUBSEQUENT images."
            }
        },
        required: ["prompt"]
    }
};

// --- CORE AGENT LOGIC: SPLIT EXECUTION PATHS ---

// Path A: Native Google SDK Loop (For Thinking/Reasoning Models)
const runReasoningAgent = async (
    history: ChatMessage[],
    newMessage: string,
    onChunk: (text: string) => void,
    signal: AbortSignal | undefined,
    systemInstruction: string,
    onToolCall?: (action: AgentAction) => void
): Promise<string> => {
    console.log("[Agent] Starting Native Reasoning Loop");
    try {
        const ai = getClient();
        
        // Prepare History (Excluding last message which is sent via sendMessageStream)
        const rawHistory = history.slice(0, Math.max(0, history.length - 1)).slice(-50);
        const effectiveHistory = convertHistoryToNativeFormat(rawHistory);
        
        // Use Gemini 3 Pro Preview for thinking/reasoning
        const chat = ai.chats.create({
            model: 'gemini-3-pro-preview', 
            history: effectiveHistory,
            config: {
                // PASS STRING DIRECTLY for System Instruction to avoid Object/Union mismatch issues
                systemInstruction: systemInstruction, 
                tools: [{ functionDeclarations: [NATIVE_IMAGE_TOOL] }],
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
                ]
            }
        });

        // Reconstruct the latest message content
        const lastMsg = history[history.length - 1];
        let msgPartsToSend: Part[] = [];
        
        if (lastMsg) {
            if (lastMsg.images?.length) {
                lastMsg.images.forEach(img => {
                    const matches = img.match(/^data:(.+);base64,(.+)$/);
                    if (matches) msgPartsToSend.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
                });
            }
            if (lastMsg.content) msgPartsToSend.push({ text: lastMsg.content });
        }
        if (msgPartsToSend.length === 0) msgPartsToSend.push({ text: newMessage || ' ' });

        let fullText = "";

        // Recursive Agent Loop
        const processTurn = async (content: Part[]) => {
            // STRICT MESSAGE FORMAT: WRAP IN { message: ... } for the new SDK signature
            const result = await chat.sendMessageStream({ message: content });
            
            const toolCalls: FunctionCall[] = [];
            
            for await (const chunk of result) {
                if (signal?.aborted) throw new Error("Cancelled");
                
                // 1. Accumulate Text (SAFE WAY)
                // Use manual iteration to avoid .text getter warning when tool calls exist
                if (chunk.candidates?.[0]?.content?.parts) {
                    for (const part of chunk.candidates[0].content.parts) {
                        if (part.text) {
                            fullText += part.text;
                            onChunk(fullText);
                        }
                    }
                }

                // 2. Collect Tool Calls
                // Use property access `chunk.functionCalls` NOT a method call
                if (chunk.functionCalls) {
                    for (const call of chunk.functionCalls) {
                         // Dedup calls if SDK yields same call across chunks
                         if (!toolCalls.some(c => c.id === call.id)) {
                             toolCalls.push(call);
                         }
                    }
                }
            }

            // 3. Execute Tools (After stream finishes)
            if (toolCalls.length > 0) {
                const responseParts: Part[] = [];
                
                for (const call of toolCalls) {
                    // Always append visual indicator for tool use, regardless of prior calls
                    fullText += "\n[Using Tool: Image Generator]\n";
                    onChunk(fullText);
                    
                    if (onToolCall) {
                        setTimeout(() => {
                            onToolCall({
                                toolName: call.name,
                                args: call.args,
                                jobId: crypto.randomUUID()
                            });
                        }, 0);
                    }
                    
                    responseParts.push({
                        functionResponse: {
                            name: call.name,
                            response: { 
                                // SYSTEM NUDGE: Explicitly tell the model to continue the loop.
                                result: `[SYSTEM_CALLBACK]: Image queued. STATUS: PENDING. \n\nREMINDER: If you just generated a Reference/Anchor Sheet (save_as_reference='IDENTITY'), you MUST STOP and wait for the user to confirm/approve it before generating the rest of the panels. Do NOT generate the sequence yet.` 
                            },
                            id: call.id
                        }
                    });
                }

                // Recursion with function response parts wrapped in message object
                if (responseParts.length > 0) {
                    await processTurn(responseParts);
                }
            }
        };

        await processTurn(msgPartsToSend);
        return fullText;
        
    } catch (error: any) {
        console.error("Native Loop Error:", error);
        // Ensure errors from Native loop are distinguished
        if (error.message && error.message.includes("ContentUnion")) {
             throw new Error("Native SDK Protocol Mismatch: " + error.message);
        }
        throw error;
    }
};

// Path B: Vercel AI SDK Loop (For Flash/Standard Models)
const runStandardAgent = async (
    history: ChatMessage[],
    onChunk: (text: string) => void,
    signal: AbortSignal | undefined,
    systemInstruction: string,
    onToolCall?: (action: AgentAction) => void,
    modelName: string = 'gemini-2.5-flash' // Default to Flash
): Promise<string> => {
    // Determine provider name
    let providerModelName = 'gemini-2.5-flash';
    if (modelName === ChatModel.GEMINI_3_PRO_FAST) {
        // Fallback or explicit usage
        providerModelName = 'gemini-2.5-flash'; 
    }
    
    console.log(`[Agent] Starting Vercel Standard Loop. Requested: ${modelName}, Using: ${providerModelName}`);
    
    const vercelGoogle = getVercelGoogle();
    const messages = convertHistoryToVercelFormat(history);

    const result = await streamText({
        model: vercelGoogle(providerModelName), 
        messages,
        system: systemInstruction,
        maxSteps: 5, // Vercel's Auto-Loop
        abortSignal: signal,
        tools: {
            generate_image: tool({
                description: "Generate one or more images based on a detailed text prompt.",
                parameters: z.object({
                    prompt: z.string().describe("A highly detailed, descriptive prompt."),
                    numberOfImages: z.number().optional().describe("Number of images (1-4)."),
                    aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
                    model: z.enum([ImageModel.FLASH, ImageModel.PRO]).optional(),
                    style: z.string().optional(),
                    resolution: z.enum(["1K", "2K", "4K"]).optional(),
                    negativePrompt: z.string().optional(),
                    seed: z.number().optional(),
                    guidanceScale: z.number().optional(),
                    save_as_reference: z.enum(["IDENTITY", "STYLE", "NONE"]).optional(),
                    use_ref_context: z.boolean().optional()
                }),
                execute: async (args) => {
                    if (onToolCall) {
                        setTimeout(() => {
                            onToolCall({
                                toolName: 'generate_image',
                                args: args,
                                jobId: crypto.randomUUID()
                            });
                        }, 0);
                    }
                    return "Image generation task has been queued successfully. If multiple images were requested, proceed with the next one.";
                }
            })
        },
    });

    let fullText = "";
    for await (const textPart of result.textStream) {
        fullText += textPart;
        onChunk(fullText);
    }
    return fullText;
};

// --- MAIN ENTRY POINT ---

export const streamChatResponse = async (
  history: ChatMessage[], 
  newMessage: string, 
  onChunk: (text: string) => void,
  model: ChatModel = ChatModel.GEMINI_3_PRO_FAST,
  mode: AppMode = AppMode.IMAGE,
  signal?: AbortSignal,
  projectContextSummary?: string,
  projectSummaryCursor?: number,
  onUpdateContext?: (newSummary: string, newCursor: number) => void,
  onToolCall?: (action: AgentAction) => void,
  useGrounding: boolean = false,
  currentParams?: GenerationParams, 
  contextAssets?: SmartAsset[] 
): Promise<string> => {
  
  // 1. Recursive Summary Update (Shared logic)
  const MAX_ACTIVE_WINDOW = 12;
  let currentContextSummary = projectContextSummary || "";
  let currentCursor = projectSummaryCursor || 0;
  const historyLen = history.length;
  const archiveBoundary = Math.max(0, historyLen - 1 - MAX_ACTIVE_WINDOW);

  if (archiveBoundary > currentCursor) {
      const deltaMessages = history.slice(currentCursor, archiveBoundary);
      try {
          currentContextSummary = await updateRecursiveSummary(currentContextSummary, deltaMessages);
          currentCursor = archiveBoundary;
          if (onUpdateContext) onUpdateContext(currentContextSummary, currentCursor);
      } catch (e) {
          console.warn("Failed to update recursive summary", e);
      }
  }

  // 2. System Instruction Build (Shared logic)
  const currentSettingsContext = currentParams ? JSON.stringify({
        model: currentParams.imageModel,
        aspectRatio: currentParams.aspectRatio,
        style: currentParams.imageStyle,
        resolution: currentParams.imageResolution,
        seed: currentParams.seed,
        guidanceScale: currentParams.guidanceScale
  }) : "Unknown";

  const contextInjection = currentContextSummary ? `\n[LONG-TERM MEMORY]\n${currentContextSummary}` : "";
  const isAutoMode = currentParams?.isAutoMode ?? true;
  const modelStr = String(model);
  const isReasoning = modelStr.includes('reasoning') || model === ChatModel.GEMINI_3_PRO_REASONING;

  const uiProtocolInstruction = `
    [IMPORTANT UI PROTOCOL]
    When you call the 'generate_image' tool, you MUST preface your response with this EXACT string on a new line:
    "[Using Tool: Image Generator]"
  `;
  
  const reasoningProtocol = `
    [PROTOCOL: CHAIN OF THOUGHT & CONSISTENCY]
    1. **MANDATORY PLANNING**: Output a plan BEFORE calling any tool.
    2. **ANCHOR-FIRST WORKFLOW (MANDATORY)**:
       - Problem: Characters look different in every frame if you generate them all at once.
       - Solution: You MUST generate a "Character Sheet" or "Reference Image" FIRST.
       - Step A: Call \`generate_image(prompt="Character sheet of...", save_as_reference="IDENTITY")\`.
       - Step B: STOP. Tell the user: "I have generated the character reference. Please confirm if you want to proceed with this look."
       - Step C: WAIT for user input.
       - Step D: ONLY AFTER the user confirms, generate the rest of the storyboard panels using \`use_ref_context=true\`.
    3. **SEQUENTIAL LOOP**: 
       - When generating the final storyboard (after approval), generate ONE image at a time. Call tool -> Wait -> Call tool.
       - Do NOT stop after the first image of the *sequence*. Loop until the plan is complete.
  `;

  const systemInstruction = `
    You are Lumina, a professional Creative Director and Agent.
    
    [CONTEXT]
    Current Settings: ${currentSettingsContext}
    Auto Mode: ${isAutoMode ? 'ON' : 'OFF'}
    ${contextInjection}

    [PROTOCOL]
    1. If the user asks for an image, analyze if it requires batch generation (sequence/variations).
    2. Use the 'generate_image' tool. If Auto Mode is ON, you can infer best settings. If OFF, adhere strictly to Current Settings unless overridden.
    3. If the first image isn't perfect, you can call the tool again with refined prompts (Self-Correction).
    4. Provide concise, helpful responses.
    
    ${isReasoning ? reasoningProtocol : uiProtocolInstruction}
  `;

  // 3. Strict Dispatch
  if (isReasoning) {
      return runReasoningAgent(history, newMessage, onChunk, signal, systemInstruction, onToolCall);
  } else {
      return runStandardAgent(history, onChunk, signal, systemInstruction, onToolCall, model);
  }
};