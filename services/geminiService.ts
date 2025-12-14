import { GoogleGenAI, GenerateContentResponse, Content, Part, FunctionDeclaration, FunctionCall, Type, HarmCategory, HarmBlockThreshold, Tool } from "@google/genai";
import { GenerationParams, AssetItem, ImageModel, ImageStyle, VideoModel, ChatMessage, ChatModel, AppMode, SmartAsset, AgentJob, VideoResolution } from "../types";

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

  // Handle 413 specifically to give a better error message
  if (message.includes('413') || message.includes('Too Large')) {
      return new Error("Context too long. The conversation history exceeded the limit. Older messages have been summarized.");
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
    
    // SAFETY: Only attach tools if model is PRO. Flash Image model does not support tools.
    // NOTE: For 'generateContent' (image generation), having tools might cause issues if not strictly handled.
    // To be safe, we only attach search if it's explicitly requested AND the model is Pro.
    if (modelName === ImageModel.PRO) {
        if (params.imageResolution) config.imageConfig.imageSize = params.imageResolution;
        if (params.useGrounding) {
             config.tools = [{ googleSearch: {} }];
        }
    } else {
        if (params.useGrounding) {
            console.warn("Grounding ignored: Not supported on Flash Image model.");
        }
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

// --- DATA CONVERSION HELPERS (Native Only) ---

// Helper: Prune images from past history to avoid token explosion
const shouldIncludeImage = (msgIndex: number, totalMessages: number, role: string) => {
    // Only keep images for the very last message if it's from USER.
    // NEVER send back Model-generated images to the API (Model knows what it made).
    if (role === 'model') return false;
    
    // For User: Only keep images in the last 2 turns
    return (totalMessages - msgIndex) <= 2;
};

const convertHistoryToNativeFormat = (history: ChatMessage[]): Content[] => {
    return history.map((msg, index) => {
        const parts: Part[] = [];
        
        // Strict Image Pruning to prevent 413 Payload Too Large
        const includeImages = shouldIncludeImage(index, history.length, msg.role);

        if (includeImages) {
            if (msg.images && msg.images.length > 0) {
                msg.images.forEach(img => {
                    const matches = img.match(/^data:(.+);base64,(.+)$/);
                    if (matches) parts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
                });
            } else if (msg.image) {
                const matches = msg.image.match(/^data:(.+);base64,(.+)$/);
                if (matches) parts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
            }
        } else if ((msg.images?.length || msg.image) && msg.role === 'model') {
            // Replace dropped model images with a placeholder
             parts.push({ text: '[Image Generated and Displayed to User]' });
        }
        
        if (msg.content) parts.push({ text: msg.content });
        if (parts.length === 0) parts.push({ text: ' ' }); // Failsafe
        
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

// --- CORE AGENT LOGIC (NATIVE SDK) ---

const runNativeAgent = async (
    history: ChatMessage[],
    newMessage: string,
    onChunk: (text: string) => void,
    signal: AbortSignal | undefined,
    systemInstruction: string,
    onToolCall?: (action: AgentAction) => void,
    modelName: string = 'gemini-2.5-flash',
    useGrounding: boolean = false
): Promise<string> => {
    console.log(`[Agent] Starting Native Loop with ${modelName} (Grounding: ${useGrounding})`);
    try {
        const ai = getClient();
        
        // Aggressively limit history length to last 15 turns
        const rawHistory = history.slice(0, Math.max(0, history.length - 1)).slice(-15);
        const effectiveHistory = convertHistoryToNativeFormat(rawHistory);
        
        let tools: Tool[] = [];
        
        // API CONSTRAINT: 'googleSearch' cannot be mixed with other functionDeclarations.
        // We must implement a "Virtual Tool" pattern for image generation when search is enabled.
        let activeSystemInstruction = systemInstruction;

        if (useGrounding) {
            // MODE A: SEARCH ENABLED -> Enable Google Search, Disable Native Image Tool
            tools = [{ googleSearch: {} }];
            
            activeSystemInstruction += `
            \n[SYSTEM MODE: SEARCH ENABLED]
            You have access to Google Search for grounding.
            
            IMPORTANT: Native tool calling for 'generate_image' is DISABLED in this mode to prevent API conflicts.
            
            PROTOCOL TO GENERATE IMAGES:
            1. Use 'googleSearch' to find real-time info if needed.
            2. To generate an image, you MUST output this EXACT command block at the end of your response:
            
            !!!GENERATE_IMAGE prompt="YOUR_DETAILED_PROMPT" aspectRatio="1:1"!!!
            
            Example:
            Found that it is raining in Tokyo...
            !!!GENERATE_IMAGE prompt="Cinematic shot of a rainy street in Tokyo at night, neon lights reflections" aspectRatio="16:9"!!!
            `;
        } else {
            // MODE B: STANDARD -> Enable Native Image Tool
            tools = [{ functionDeclarations: [NATIVE_IMAGE_TOOL] }];
        }
        
        // Create Chat Instance
        const chat = ai.chats.create({
            model: modelName, 
            history: effectiveHistory,
            config: {
                systemInstruction: activeSystemInstruction, 
                tools,
                // Ensure we don't accidentally enforce JSON mode unless needed
                responseMimeType: 'text/plain',
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
            // Only send images if it's the User's NEW message
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
            // STRICT MESSAGE FORMAT: Native SDK expects { message: string | Part[] }
            const result = await chat.sendMessageStream({ message: content });
            
            const toolCalls: FunctionCall[] = [];
            
            for await (const chunk of result) {
                if (signal?.aborted) throw new Error("Cancelled");
                
                // 1. Accumulate Text (SAFE WAY)
                if (chunk.candidates?.[0]?.content?.parts) {
                    for (const part of chunk.candidates[0].content.parts) {
                        if (part.text) {
                            fullText += part.text;
                            onChunk(fullText);
                        }
                    }
                }

                // 2. Collect Native Tool Calls (Only happens if useGrounding is false)
                if (chunk.functionCalls) {
                    for (const call of chunk.functionCalls) {
                         if (!toolCalls.some(c => c.id === call.id)) {
                             toolCalls.push(call);
                         }
                    }
                }
            }

            // 3. Execute Native Tools (If any)
            if (toolCalls.length > 0) {
                const responseParts: Part[] = [];
                
                for (const call of toolCalls) {
                    // Always append visual indicator
                    const toolNotif = `\n\n[Using Tool: ${call.name}]`;
                    if (!fullText.includes(toolNotif)) {
                        fullText += toolNotif;
                        onChunk(fullText);
                    }
                    
                    if (onToolCall && call.name === 'generate_image') {
                        setTimeout(() => {
                            onToolCall({
                                toolName: call.name,
                                args: call.args,
                                jobId: crypto.randomUUID()
                            });
                        }, 0);
                    }
                    
                    let systemFeedback = `[SYSTEM_CALLBACK]: Action processed.`;
                    if (call.name === 'generate_image') {
                        systemFeedback = `[SYSTEM_CALLBACK]: Image queued.`;
                    }

                    responseParts.push({
                        functionResponse: {
                            name: call.name,
                            response: { result: systemFeedback },
                            id: call.id
                        }
                    });
                }

                // Recursion
                if (responseParts.length > 0) {
                    await processTurn(responseParts);
                }
            }
        };

        await processTurn(msgPartsToSend);

        // 4. PARSE VIRTUAL TOOL COMMAND (Only if useGrounding is true)
        if (useGrounding) {
            // Regex to find !!!GENERATE_IMAGE prompt="..." aspectRatio="..."!!!
            // Handles potential newlines or extra spaces
            const pattern = /!!!GENERATE_IMAGE\s+prompt="([\s\S]*?)"(?:\s+aspectRatio="([^"]*)")?\s*!!!/;
            const match = fullText.match(pattern);
            
            if (match) {
                const prompt = match[1];
                const aspectRatio = match[2] || "1:1";
                
                console.log("[Virtual Tool] Detected command:", prompt);
                
                if (onToolCall) {
                    // Fire async to not block UI update
                    setTimeout(() => {
                        onToolCall({
                            toolName: 'generate_image',
                            args: { 
                                prompt: prompt, 
                                aspectRatio: aspectRatio,
                                // Important: Pass grounding state so the generator knows to upgrade model
                                useGrounding: true 
                            },
                            jobId: crypto.randomUUID()
                        });
                    }, 0);
                }
            }
        }

        return fullText;
        
    } catch (error: any) {
        console.error("Native Loop Error:", error);
        if (error.message && error.message.includes("ContentUnion")) {
             throw new Error("Native SDK Protocol Mismatch: " + error.message);
        }
        throw error;
    }
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

  const reasoningProtocol = `
    [PROTOCOL: VISUAL REASONING ENGINE]
    
    1. **EVALUATE COMPLEXITY**: Before generating, analyze the user's prompt for these factors:
       - **Text Rendering**: Does it require legible text? (e.g. "a sign saying hello") -> HIGH COMPLEXITY
       - **Structure/Anatomy**: Are there complex mechanical parts, specific human poses, or hands? -> HIGH COMPLEXITY
       - **Lighting/Composition**: Is it a cinematic scene with complex lighting or multiple subjects? -> HIGH COMPLEXITY
       - **Simple/Abstract**: Is it a flat icon, abstract pattern, or simple sketch? -> LOW COMPLEXITY
       
    2. **SELECT MODEL (Auto Mode)**:
       - **HIGH COMPLEXITY** -> Set \`model='gemini-3-pro-image-preview'\`.
       - **LOW COMPLEXITY** -> Set \`model='gemini-2.5-flash-image'\` (Faster/Cheaper).
       - **REAL-TIME INFO** -> If prompt requires real-world data (e.g. "Today's Google Doodle"), perform a SEARCH FIRST using your search tool. Then use the text info to write the prompt.

    3. **ANCHOR-FIRST EXECUTION (Storyboards)**:
       - For sequential consistency, generate the main character first with \`save_as_reference="IDENTITY"\`.
  `;

  const systemInstruction = `
    You are Lumina, an intelligent Creative Director.
    
    [CONTEXT]
    Current Settings: ${currentSettingsContext}
    Auto Mode: ${isAutoMode ? 'ON' : 'OFF'}
    Search Enabled: ${useGrounding ? 'YES' : 'NO'}
    ${contextInjection}

    [CORE OPERATING RULES]
    1. **AMBIGUITY CHECK & PLANNING**: 
       - If prompt is vague ("draw a dog"), ask clarifying questions (Style? Breed?) unless user says "Surprise me".
       - **MANDATORY PLANNING PHASE**: For complex requests involving *sequences*, *comics*, *storyboards* (e.g. "4-panel comic", "video storyboard"), or *specific character designs*, you MUST output a text-based "Concept Plan" first and ask the user for confirmation BEFORE calling any generation tools.
       - Exception: If the user explicitly says "Generate immediately", "Surprise me", or "No need to ask".

    2. **VISUAL REASONING**: Don't just match keywords. Understand the *intrinsic* difficulty of the image.
       - "A detailed map of Middle Earth" -> Complex (Pro)
       - "Blue circle logo" -> Simple (Flash)
    3. **TOOLS**: 
       - Use 'generate_image' for visual tasks. 
       - Use 'googleSearch' (if enabled) for real-time information. 
       - **WORKFLOW**: If the user asks for something requiring real-time info (e.g. "Weather in Tokyo now"), DO NOT guess. Use the 'googleSearch' tool first to find the answer. THEN, use 'generate_image' with the specific details you found (e.g. "Rainy Tokyo street at night"). Do NOT ask the Image Tool to search for you if you can do it yourself.
    4. **PERSONA**: Be concise, professional, and helpful.
    
    ${isReasoning ? reasoningProtocol : ''}
  `;

  // 3. Strict Dispatch - NOW ALL PATHS USE NATIVE AGENT
  let targetModel = 'gemini-2.5-flash';
  if (isReasoning) {
      targetModel = 'gemini-3-pro-preview';
  } else {
      targetModel = 'gemini-2.5-flash';
  }

  return runNativeAgent(history, newMessage, onChunk, signal, systemInstruction, onToolCall, targetModel, useGrounding);
};