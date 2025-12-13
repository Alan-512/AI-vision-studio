import { GoogleGenAI, GenerateContentResponse, Content, Part, FunctionDeclaration, Tool as GeminiTool, FunctionCall, Type } from "@google/genai";
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

  if (message.includes('{"error"') || message.includes('{"code"')) {
    try {
      const jsonMatch = message.match(/(\{.*\})/);
      const jsonStr = jsonMatch ? jsonMatch[0] : message;
      const parsed = JSON.parse(jsonStr);

      if (parsed.error) {
        if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
          return new Error("Quota Exceeded. You have reached the daily generation limit for this API Key. Please create a new API Key to continue.");
        }
        if (parsed.error.message) {
          if (parsed.error.message.includes('quota') || parsed.error.message.includes('429')) {
             return new Error("Quota Exceeded. You have reached the daily generation limit for this API Key. Please create a new API Key to continue.");
          }
          message = parsed.error.message;
        }
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }

  if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('Quota')) {
      return new Error("Quota Exceeded. You have reached the daily generation limit for this API Key. Please create a new API Key to continue.");
  }

  if (message.includes('<html') || message.includes('<!DOCTYPE')) {
      return new Error("Access Denied (403). The model request was blocked by the server. Please try the 'Gemini 2.5 Flash' model.");
  }

  if (message.includes('403') || message.includes('permission')) {
     return new Error("Access Denied. This model (Pro/Veo) requires a paid API Key. Please switch to 'Gemini 2.5 Flash'.");
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
      if (error.message === 'Cancelled' || error.name === 'AbortError') {
        throw error;
      }

      const parsedError = parseError(error);
      const msg = parsedError.message;

      if (msg.includes('Quota') || msg.includes('429') || msg.includes('Limit') || msg.includes('RESOURCE_EXHAUSTED')) {
          throw parsedError;
      }

      const status = error?.status || error?.response?.status;
      const isRetryable =
        (status === 503 || status === 504 || status === 500) ||
        (msg.includes('503') || msg.includes('overloaded'));

      if (retries > 0 && isRetryable) {
        console.warn(`[Lumina] Request failed (${status || msg}). Retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
        return this.retry(task, retries - 1, delay * 2);
      }
      throw parsedError;
    }
  }
}

const imageQueue = new RequestQueue(4); 
const videoQueue = new RequestQueue(1);

// -------------------

// --- NEW EXPORTED FUNCTIONS ---

export const testConnection = async (apiKey: string): Promise<boolean> => {
  try {
    const ai = new GoogleGenAI({ apiKey });
    await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Test',
    });
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
    
    if (!validModels.includes(modelName)) {
        console.warn(`[Service] Invalid model '${modelName}' detected. Falling back to Gemini 3 Pro.`);
        modelName = ImageModel.PRO; 
    }
    
    const parts: Part[] = [];
    
    if (params.smartAssets) {
        for (const asset of params.smartAssets) {
            parts.push({
                inlineData: {
                    mimeType: asset.mimeType,
                    data: asset.data
                }
            });
        }
    }
    
    let finalPrompt = params.prompt;
    if (params.negativePrompt) {
        finalPrompt += ` --negative_prompt="${params.negativePrompt}"`; 
    }
    if (params.imageStyle && params.imageStyle !== ImageStyle.NONE) {
        finalPrompt += `. Style: ${params.imageStyle}`;
    }
    
    parts.push({ text: finalPrompt });

    const config: any = {
        imageConfig: {
            aspectRatio: params.aspectRatio,
        }
    };

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

    if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
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
        if (textPart) {
             throw new Error(`Model Refusal: ${textPart.text}`);
        }
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
            guidanceScale: params.guidanceScale,
            usedGrounding: params.useGrounding
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
       
       let operation: any;
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
           requestParams.image = {
               imageBytes: params.videoStartImage,
               mimeType: params.videoStartImageMimeType || 'image/png'
           };
       }
       
       if (params.videoEndImage) {
           config.lastFrame = {
               imageBytes: params.videoEndImage,
               mimeType: params.videoEndImageMimeType || 'image/png'
           };
       }
       
       if (params.videoModel === VideoModel.VEO_HQ && params.videoStyleReferences && params.videoStyleReferences.length > 0) {
           config.referenceImages = params.videoStyleReferences.map(ref => ({
               image: {
                   imageBytes: ref.data,
                   mimeType: ref.mimeType
               },
               referenceType: 'ASSET'
           }));
       }
       
       if (onStart) onStart();
       
       operation = await makeAbortable(ai.models.generateVideos(requestParams), signal);
       
       if (onOperationId && operation.name) {
           await onOperationId(operation.name);
       }

       while (!operation.done) {
           if (signal?.aborted) throw new Error("Cancelled");
           
           await new Promise((resolve, reject) => {
               const timer = setTimeout(resolve, 5000);
               if (signal) {
                   signal.addEventListener('abort', () => {
                       clearTimeout(timer);
                       reject(new Error("Cancelled"));
                   }, { once: true });
               }
           });
           
           operation = await makeAbortable(ai.operations.getVideosOperation({ operation }), signal);
       }
       
       if (operation.error) {
           throw parseError(operation.error);
       }
       
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

        if (operation.error) {
            throw parseError(operation.error);
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) throw new Error("No video URI returned.");

        const keyToUse = getUserApiKey() || process.env.API_KEY;
        const response = await fetch(`${downloadLink}&key=${keyToUse}`);
        if (!response.ok) throw new Error("Failed to download video.");

        const blob = await response.blob();
        return URL.createObjectURL(blob);
    });
};

// ------------------------------

export const optimizePrompt = async (originalPrompt: string, mode: AppMode, smartAssets?: SmartAsset[]): Promise<string> => {
  if (!originalPrompt.trim()) return "";
  
  const ai = getClient();
  
  let assetContext = "";
  if (smartAssets && smartAssets.length > 0) {
      const types = smartAssets.map(a => a.type);
      assetContext = `\nCONTEXT: The user has attached ${smartAssets.length} reference images with the following roles: ${types.join(', ')}.`;
      
      if (types.includes('STRUCTURE')) {
          assetContext += `\n- STRUCTURE/LAYOUT image provided: The prompt must explicitly state to "follow the composition and layout of the reference image".`;
      }
      if (types.includes('STYLE')) {
          assetContext += `\n- STYLE image provided: The prompt should mention "in the artistic style of the reference image" but NOT describe the reference's content (unless relevant).`;
      }
      if (types.includes('IDENTITY')) {
          assetContext += `\n- IDENTITY image provided: The prompt must emphasize "maintaining the character/object identity".`;
      }
  }

  let task = "";
  if (mode === AppMode.VIDEO) {
    task = `You are an expert Film Director and Prompt Engineer for AI Video generation (Google Veo). 
    Rewrite the following user prompt into a single, high-quality, descriptive caption optimized for Veo.
    
    OFFICIAL GUIDELINES:
    1. **Structure**: Follow this flow: (Subject + Action) + (Environment + Lighting) + (Camera Movement + Style).
    2. **Natural Language**: Write as a fluid, natural sentence, NOT a list of tags.
    3. **Visuals Only**: Describe what is seen. Avoid abstract words like "amazing" or "thought-provoking".
    4. **Motion**: Use strong verbs to describe movement (e.g., "sprinting", "morphing", "gliding").
    5. **Camera**: Explicitly state camera movement (e.g., "Drone tracking shot", "Slow pan right", "Static camera").
    6. **Conciseness**: Keep it under 70 words.
    ${assetContext}

    Original Input: "${originalPrompt}"
    
    Output ONLY the refined prompt text. Do not add quotes.`;
  } else {
    task = `You are an expert Prompt Engineer for Google's Gemini Image Generation models.
    Rewrite the user's prompt to be descriptive, visually rich, and structured.
    
    OFFICIAL BEST PRACTICES:
    1. **Be Descriptive**: Gemini models thrive on detail. Don't say "a car"; say "a vintage 1960s red convertible sports car with chrome details".
    2. **Natural Language**: Use fluid sentences, not a list of tags. If the input is a list of tags (e.g. from a Prompt Builder), weave them into a coherent narrative.
    3. **Structure**: Subject -> Context/Background -> Art Style/Medium -> Lighting/Atmosphere -> Technical Details (e.g., "4k", "highly detailed").
    4. **No Restrictions**: Do NOT restrict word count. Use as many words as necessary to vividly describe the scene (aim for 50-100 words if needed for detail).
    ${assetContext}
    
    Original Input: "${originalPrompt}"
    
    Output ONLY the refined prompt text. Do not add quotes.`;
  }
    
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: task,
    });
    return response.text?.trim() || originalPrompt;
  } catch (e) {
    console.warn("Prompt optimization failed", e);
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
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType
            }
          },
          {
            text: "Analyze this image and provide a concise, high-quality prompt for generating a similar image. Focus on subject, art style, lighting, composition, and key details. Output ONLY the prompt string without markdown or quotes."
          }
        ]
      }
    });
    return response.text?.trim() || "";
  } catch (e) {
    console.error("Describe image failed", e);
    throw new Error("Failed to analyze image.");
  }
};

export const generateProjectName = async (prompt: string): Promise<string> => {
  try {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Generate a very short, concise title (max 4 words) for a creative project based on this prompt: "${prompt}". Do not use quotes.`,
    });
    return response.text?.trim() || "Creative Project";
  } catch (e) {
    console.warn("Failed to auto-generate project name", e);
    return "New Project";
  }
};

export const extractPromptFromHistory = async (history: ChatMessage[], mode: AppMode = AppMode.IMAGE): Promise<string> => {
  try {
    const ai = getClient();
    const recentHistory = history.slice(-20);

    const conversationText = recentHistory.map(msg => {
      const imgCount = (msg.images?.length || (msg.image ? 1 : 0));
      const cleanContent = msg.content.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
      return `${msg.role}: ${cleanContent} ${imgCount > 0 ? `[User uploaded ${imgCount} images]` : ''}`;
    }).join('\n');
    
    const contextInstruction = mode === AppMode.VIDEO 
      ? "Extract the final, most detailed VIDEO generation prompt. Focus on camera movement, scene description, motion, lighting, and mood."
      : "Extract the final, most detailed IMAGE generation prompt. Focus on composition, lighting, style, and visual details.";

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `You are a professional prompt engineer. Read the following conversation between a user and an AI assistant.
      
      CONVERSATION:
      ${conversationText}
      
      TASK:
      ${contextInstruction}
      Ignore conversational filler, greetings, or "sure I can help with that". 
      Output ONLY the raw prompt text. Do not add "Here is the prompt" or quotes.
      `
    });
    
    return response.text?.trim() || "";
  } catch (e) {
    console.error("Failed to extract prompt", e);
    throw new Error("Failed to summarize conversation.");
  }
};

const updateRecursiveSummary = async (
    currentSummary: string, 
    newMessages: ChatMessage[]
): Promise<string> => {
  if (newMessages.length === 0) return currentSummary;
  
  const ai = getClient();
  const deltaText = newMessages.map(m => {
     const cleanContent = m.content.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
     let imgMarker = "";
     if (m.images && m.images.length > 0) {
         imgMarker = `[User uploaded ${m.images.length} images]`;
     } else if (m.image) {
         imgMarker = `[User uploaded 1 image]`;
     }
     return `${m.role.toUpperCase()}: ${cleanContent} ${imgMarker}`;
  }).join('\n');
  
  const prompt = `
  You are the memory manager for a creative AI assistant.
  
  CURRENT MEMORY STATE:
  "${currentSummary || "No previous context."}"
  
  NEW INTERACTIONS (Delta):
  ${deltaText}
  
  TASK:
  Update the "Current Memory State" to include key information from the "New Interactions".
  - Keep it concise.
  - Retain important user preferences, art styles, and project goals.
  - Discard conversational filler (hello, thanks).
  - Do NOT output JSON. Output the raw summary text.
  `;

  try {
     const resp = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
     });
     return resp.text?.trim() || currentSummary;
  } catch (e) {
     console.warn("Recursive summary update failed", e);
     return currentSummary;
  }
};

// Convert chat history to Vercel AI SDK Core format
// UPDATED: Prefer string content for simplicity when no images are present to avoid "ContentUnion" schema errors.
const convertHistoryToVercelFormat = (history: ChatMessage[]): CoreMessage[] => {
    return history.map(msg => {
        const parts: any[] = [];
        
        // Add Images
        if (msg.images?.length) {
            msg.images.forEach(img => {
                const matches = img.match(/^data:(.+);base64,(.+)$/);
                if (matches) parts.push({ type: 'image', image: matches[2], mimeType: matches[1] });
            });
        } else if (msg.image) {
             const matches = msg.image.match(/^data:(.+);base64,(.+)$/);
             if (matches) parts.push({ type: 'image', image: matches[2], mimeType: matches[1] });
        }
        
        const textContent = msg.content || ''; // Do not strip thoughts here for history context
        
        if (parts.length > 0) {
            // Mixed content (Image + Text)
            if (textContent) {
                parts.push({ type: 'text', text: textContent });
            } else if (parts.length > 0 && !textContent) {
                 // If we have images but no text, Vercel SDK sometimes dislikes empty text parts in mixed array.
                 // But we don't need to push empty text part if images exist.
            }
            return {
                role: msg.role === 'model' ? 'assistant' : 'user',
                content: parts
            } as CoreMessage;
        } else {
            // Text only - Return simple string to minimize schema issues
            return {
                role: msg.role === 'model' ? 'assistant' : 'user',
                content: textContent || ' ' // Ensure non-empty string
            } as CoreMessage;
        }
    });
};

// --- NATIVE SDK HELPERS FOR REASONING MODEL ---
const convertHistoryToNativeFormat = (history: ChatMessage[]): Content[] => {
    return history.map(msg => {
        const parts: Part[] = [];
        if (msg.images && msg.images.length > 0) {
            msg.images.forEach(img => {
                const matches = img.match(/^data:(.+);base64,(.+)$/);
                if (matches) {
                    parts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
                }
            });
        } else if (msg.image) {
            const matches = msg.image.match(/^data:(.+);base64,(.+)$/);
            if (matches) {
                parts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
            }
        }
        
        if (msg.content) {
             parts.push({ text: msg.content });
        }

        // FAILSAFE: Ensure at least one part exists
        if (parts.length === 0) {
            parts.push({ text: ' ' });
        }
        
        return {
            role: msg.role,
            parts: parts
        };
    });
};

const NATIVE_IMAGE_TOOL: FunctionDeclaration = {
    name: 'generate_image',
    description: "Generate one or more images based on a detailed text prompt.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            prompt: { type: Type.STRING, description: "A highly detailed, descriptive prompt." },
            numberOfImages: { type: Type.NUMBER, description: "Number of images (1-4)." },
            aspectRatio: { type: Type.STRING, enum: ["1:1", "16:9", "9:16", "4:3", "3:4"] },
            model: { type: Type.STRING, enum: [ImageModel.FLASH, ImageModel.PRO] },
            style: { type: Type.STRING },
            resolution: { type: Type.STRING, enum: ["1K", "2K", "4K"] },
            negativePrompt: { type: Type.STRING },
            seed: { type: Type.NUMBER },
            guidanceScale: { type: Type.NUMBER },
            save_as_reference: { type: Type.STRING, enum: ["IDENTITY", "STYLE", "NONE"] },
            use_ref_context: { type: Type.BOOLEAN }
        },
        required: ["prompt"]
    }
};

// ----------------------------------------------

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
  
  // Update Recursive Summary Logic
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
          console.warn("Failed to update recursive summary, continuing with old context", e);
      }
  }

  // Build Context for System Prompt
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
  
  // Determine if using reasoning model (Thinking)
  const isReasoning = model === ChatModel.GEMINI_3_PRO_REASONING;

  // UI Protocol
  const uiProtocolInstruction = `
    [IMPORTANT UI PROTOCOL]
    When you call the 'generate_image' tool, you MUST preface your response with this EXACT string on a new line:
    "[Using Tool: Image Generator]"
  `;
  
  const reasoningProtocol = `
    [PROTOCOL]
    1. Think through the user's request.
    2. If an image is needed, call the 'generate_image' tool immediately after your thought process.
    3. Do NOT output conversational filler like "Okay" before the tool call.
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

  // === STRATEGY SELECTION ===

  // STRATEGY A: NATIVE SDK (For Reasoning/Thinking Models)
  // This bypasses Vercel SDK to correctly handle 'thought_signature' in the session state.
  if (isReasoning) {
      const ai = getClient();
      
      // Calculate effective history length to slice
      // We want to initialize the chat with history EXCLUDING the latest user message
      // because we send the latest message via sendMessageStream to trigger generation.
      const rawHistory = history.slice(0, Math.max(0, history.length - 1)).slice(-50);
      const effectiveHistory = convertHistoryToNativeFormat(rawHistory);
      
      const freshChat = ai.chats.create({
          model: 'gemini-3-pro-preview',
          history: effectiveHistory,
          config: {
              systemInstruction: systemInstruction,
              tools: [{ functionDeclarations: [NATIVE_IMAGE_TOOL] }]
          }
      });

      // Prepare new message content
      // IMPORTANT: We must reconstruct the latest message from the history object (last element)
      // because the 'newMessage' argument string does NOT contain image data if the user uploaded images.
      const lastMsg = history[history.length - 1];
      let msgPartsToSend: Part[] = [];
      
      if (lastMsg) {
          if (lastMsg.images && lastMsg.images.length > 0) {
              lastMsg.images.forEach(img => {
                  const matches = img.match(/^data:(.+);base64,(.+)$/);
                  if (matches) {
                      msgPartsToSend.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
                  }
              });
          } else if (lastMsg.image) {
              const matches = lastMsg.image.match(/^data:(.+);base64,(.+)$/);
              if (matches) {
                  msgPartsToSend.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
              }
          }
          
          if (lastMsg.content) {
              msgPartsToSend.push({ text: lastMsg.content });
          }
      }

      // Fallback if somehow empty
      if (msgPartsToSend.length === 0) {
           msgPartsToSend.push({ text: newMessage || ' ' });
      }

      // Send Message Stream
      let fullText = "";
      
      const sendAndProcess = async (msgContent: string | Part[] | any) => {
          const result = await freshChat.sendMessageStream(msgContent);
          
          for await (const chunk of result) {
               // Check for Text
               const chunkText = chunk.text;
               if (chunkText) {
                   fullText += chunkText;
                   onChunk(fullText);
               }

               // Check for Tool Calls
               const calls = chunk.functionCalls();
               if (calls && calls.length > 0) {
                   for (const call of calls) {
                       // Notify UI we are using tool
                       if (!fullText.includes('[Using Tool:')) {
                           fullText += "\n[Using Tool: Image Generator]\n";
                           onChunk(fullText);
                       }
                       
                       // Execute Tool
                       if (onToolCall) {
                           setTimeout(() => {
                               onToolCall({
                                   toolName: call.name,
                                   args: call.args,
                                   jobId: crypto.randomUUID()
                               });
                           }, 0);
                       }
                       
                       // Send Response back to Model to close the loop
                       const functionResponse = {
                           functionResponses: [{
                               response: { result: "Image generation task queued successfully." },
                               id: call.id,
                               name: call.name
                           }]
                       };
                       
                       // Recursive call for the next turn
                       await sendAndProcess(functionResponse); 
                   }
               }
          }
      };

      await sendAndProcess(msgPartsToSend);
      return fullText;
  }

  // STRATEGY B: VERCEL AI SDK (For Flash/Standard Models)
  // Maintains compatibility with existing robust logic for non-thinking models.
  else {
      const vercelGoogle = getVercelGoogle();
      const messages = convertHistoryToVercelFormat(history);

      const tools: Record<string, any> = {
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
                  return "Image generation task has been queued successfully. Tell the user you are generating it.";
              }
          })
      };

      try {
          const result = await streamText({
              model: vercelGoogle('gemini-2.5-flash'), 
              messages,
              system: systemInstruction,
              maxSteps: 5, 
              abortSignal: signal,
              tools: tools,
          });

          let fullText = "";
          for await (const textPart of result.textStream) {
              fullText += textPart;
              onChunk(fullText);
          }
          return fullText;
      } catch (err: any) {
          console.warn("Vercel SDK Stream failed", err);
          throw err;
      }
  }
};