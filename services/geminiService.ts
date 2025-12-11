import { GoogleGenAI, GenerateContentResponse, Content, Part, FunctionDeclaration, Tool, FunctionCall } from "@google/genai";
import { GenerationParams, AspectRatio, ImageResolution, VideoResolution, AssetItem, ImageModel, ImageStyle, VideoStyle, VideoDuration, VideoModel, ChatMessage, ChatModel, AppMode, SmartAsset } from "../types";

const USER_API_KEY_STORAGE_KEY = 'user_gemini_api_key';

// Mapping of translation keys to English descriptors for AI prompting consistency
const TAG_TO_ENGLISH: Record<string, string> = {
    'tag.person': 'Person',
    'tag.face': 'Face',
    'tag.product': 'Product',
    'tag.clothing': 'Clothing',
    'tag.background': 'Background',
    'tag.layout': 'Layout',
    'tag.pose': 'Pose',
    'tag.depth': 'Depth',
    'tag.sketch': 'Sketch',
    'tag.color': 'Color',
    'tag.lighting': 'Lighting',
    'tag.texture': 'Texture',
    'tag.artstyle': 'Art Style'
};

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
  
  // 1. Extract the raw string message from various error forms
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

  // 2. Try to parse if the message looks like JSON (handling prefixes like "Error: ...")
  if (message.includes('{"error"') || message.includes('{"code"')) {
    try {
      const jsonMatch = message.match(/(\{.*\})/);
      const jsonStr = jsonMatch ? jsonMatch[0] : message;
      const parsed = JSON.parse(jsonStr);

      if (parsed.error) {
        // Specific check for 429/Quota
        if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
          return new Error("Quota Exceeded. You have reached the daily generation limit for this API Key. Please create a new API Key to continue.");
        }
        if (parsed.error.message) {
          // If the inner message is the quota message, clean it up
          if (parsed.error.message.includes('quota') || parsed.error.message.includes('429')) {
             return new Error("Quota Exceeded. You have reached the daily generation limit for this API Key. Please create a new API Key to continue.");
          }
          message = parsed.error.message;
        }
      }
    } catch (e) {
      // Ignore parsing errors, stick with original message
    }
  }

  // 3. Keyword checks on the cleaned message
  if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('Quota')) {
      return new Error("Quota Exceeded. You have reached the daily generation limit for this API Key. Please create a new API Key to continue.");
  }

  // Detect HTML in message directly (Proxy/WAF errors)
  if (message.includes('<html') || message.includes('<!DOCTYPE')) {
      return new Error("Access Denied (403). The model request was blocked by the server. Please try the 'Gemini 2.5 Flash' model.");
  }

  // Common Google API 403 text
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
      // Don't retry if cancelled
      if (error.message === 'Cancelled' || error.name === 'AbortError') {
        throw error;
      }

      const parsedError = parseError(error);
      const msg = parsedError.message;

      // CRITICAL: Do NOT retry on Quota Exceeded as it won't resolve instantly
      if (msg.includes('Quota') || msg.includes('429') || msg.includes('Limit') || msg.includes('RESOURCE_EXHAUSTED')) {
          throw parsedError;
      }

      // Retry on Server Errors (503, 500, 504)
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

// Separate queues for Image (fast/bursty) and Video (slow/heavy)
const imageQueue = new RequestQueue(4); 
// CRITICAL: Limit video concurrency to 1 to avoid 429 quota errors
const videoQueue = new RequestQueue(1);

// --- End Concurrency Logic ---

// --- AGENT TOOLS ---
const generateImageTool: FunctionDeclaration = {
  name: "generate_image",
  description: "Generate an image based on a detailed text prompt. Use this when the user asks to create, draw, or generate an image.",
  parameters: {
    type: "OBJECT",
    properties: {
      prompt: { 
        type: "STRING", 
        description: "A highly detailed, descriptive prompt for the image generation model. Include style, lighting, composition, and subject details." 
      },
      aspectRatio: {
        type: "STRING",
        enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        description: "The aspect ratio of the image. Default to 1:1 if not specified."
      }
    },
    required: ["prompt"]
  }
};

const tools: Tool[] = [
  { functionDeclarations: [generateImageTool] }
];
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
    
    const modelName = params.imageModel || ImageModel.FLASH; 
    
    // Construct Content
    const parts: Part[] = [];
    
    // Add Smart Assets
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
    
    // Add Prompt
    let finalPrompt = params.prompt;
    if (params.negativePrompt) {
        // Appending negative prompt as text convention, though native support varies
        finalPrompt += ` --negative_prompt="${params.negativePrompt}"`; 
    }
    if (params.imageStyle && params.imageStyle !== ImageStyle.NONE) {
        finalPrompt += `. Style: ${params.imageStyle}`;
    }
    
    parts.push({ text: finalPrompt });

    // Config
    const config: any = {
        imageConfig: {
            aspectRatio: params.aspectRatio,
        }
    };

    if (modelName === ImageModel.PRO) {
        // Pro features
        if (params.imageResolution) config.imageConfig.imageSize = params.imageResolution;
        if (params.useGrounding) config.tools = [{ googleSearch: {} }];
    }
    
    if (params.seed !== undefined) config.seed = params.seed;

    // WRAP IN ABORTABLE
    const response: GenerateContentResponse = await makeAbortable(ai.models.generateContent({
        model: modelName,
        contents: { parts },
        config
    }), signal);
    
    // Extract Image
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
        // Fallback check if text was returned instead (e.g. refusal)
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
       
       // WRAP IN ABORTABLE
       operation = await makeAbortable(ai.models.generateVideos(requestParams), signal);
       
       if (onOperationId && operation.name) {
           await onOperationId(operation.name);
       }

       // Polling
       while (!operation.done) {
           if (signal?.aborted) throw new Error("Cancelled");
           
           // Abortable Sleep
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
  
  // Construct context string about assets
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

const messageToParts = (msg: ChatMessage): Part[] => {
  const parts: Part[] = [];
  if (msg.images && msg.images.length > 0) {
    msg.images.forEach(img => {
      const matches = img.match(/^data:(.+);base64,(.+)$/);
      if (matches) {
        parts.push({
          inlineData: {
            mimeType: matches[1],
            data: matches[2]
          }
        });
      }
    });
  } else if (msg.image) {
    const matches = msg.image.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      parts.push({
        inlineData: {
          mimeType: matches[1],
          data: matches[2]
        }
      });
    }
  }

  if (msg.content && msg.content.trim() !== "") {
    parts.push({ text: msg.content });
  } else {
    parts.push({ text: " " });
  }
  return parts;
};

const buildHistoryContent = (pastMessages: ChatMessage[], maxImagesToKeep: number = 3): Content[] => {
  const historyContent: Content[] = [];
  let lastRole: string | null = null;
  const allowedImageIndices = new Set<number>();
  let imagesFound = 0;
  
  for (let i = pastMessages.length - 1; i >= 0; i--) {
     const msg = pastMessages[i];
     const hasImage = (msg.images && msg.images.length > 0) || !!msg.image;
     if (hasImage && msg.role === 'user') {
        if (imagesFound < maxImagesToKeep) {
            allowedImageIndices.add(i);
            imagesFound++;
        }
     }
  }

  for (let i = 0; i < pastMessages.length; i++) {
    const msg = pastMessages[i];
    let parts: Part[] = [];
    const hasImage = (msg.images && msg.images.length > 0) || !!msg.image;
    
    if (hasImage && !allowedImageIndices.has(i)) {
       if (msg.content && msg.content.trim() !== "") {
           parts.push({ text: msg.content + "\n\n[System: Older image attachments removed to conserve context window. Focus on recent images.]" });
       } else {
           parts.push({ text: "[System: Older image attachments removed to conserve context window.]" });
       }
    } else {
       parts = messageToParts(msg);
    }
    
    if (msg.role === 'model') {
       parts = parts.map(p => {
           if (p.text) {
               const cleanedText = p.text.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
               return cleanedText.length > 0 ? { ...p, text: cleanedText } : { ...p, text: " " };
           }
           return p;
       });
    }
    
    const validParts = parts.filter(p => p.inlineData || (p.text && p.text.trim().length >= 0));

    if (validParts.length > 0) {
        if (lastRole === msg.role) {
            if (msg.role === 'user') {
                historyContent.push({ role: 'model', parts: [{ text: " " }] });
            } else {
                historyContent.push({ role: 'user', parts: [{ text: " " }] });
            }
        }
        historyContent.push({
          role: msg.role,
          parts: validParts
        });
        lastRole = msg.role;
    }
  }

  if (historyContent.length > 0 && historyContent[historyContent.length - 1].role === 'user') {
      historyContent.push({ role: 'model', parts: [{ text: " " }] });
  }

  return historyContent;
};

export interface AgentAction {
  toolName: string;
  args: any;
}

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
  onToolCall?: (action: AgentAction) => void // NEW CALLBACK
): Promise<string> => {
  const ai = getClient();
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
          if (onUpdateContext) {
              onUpdateContext(currentContextSummary, currentCursor);
          }
      } catch (e) {
          console.warn("Failed to update recursive summary, continuing with old context", e);
      }
  }

  const activeMessages = history.slice(-MAX_ACTIVE_WINDOW - 1, -1);
  const currentMessage = history[history.length - 1];

  let validActiveMessages = [...activeMessages];
  if (validActiveMessages.length > 0 && validActiveMessages[0].role === 'model') {
       validActiveMessages.shift();
  }

  const historyContent = buildHistoryContent(validActiveMessages, 3);

  let apiModelName = 'gemini-2.5-flash'; 
  let modelConfig: any = {};
  
  if (model === ChatModel.GEMINI_3_PRO_REASONING) {
    apiModelName = 'gemini-3-pro-preview';
    modelConfig = {
      thinkingConfig: {
        thinkingBudget: 16384, 
        includeThoughts: true
      },
      // FIXED: Ensure tools are enabled for Thinking Model too
      tools: tools
    };
  } else {
    // Default to Flash for the Agent Logic as it handles tools well
    apiModelName = 'gemini-2.5-flash';
    // ENABLE TOOLS for the default model
    modelConfig.tools = tools; 
  }
  
  let roleInstruction = "";
  if (mode === AppMode.VIDEO) {
    roleInstruction = `You are a professional Film Director AI assistant.
    Your goal is to help the user create videos.
    If the user asks to generate a video, confirm the details (subject, motion, camera) and then acknowledge.
    Note: You cannot directly generate videos via tools yet, but you can guide them.
    `;
  } else {
    // UPDATED SYSTEM PROMPT FOR CONSULTATIVE AGENT
    roleInstruction = `You are a professional Creative Director and Agent.
    You have access to a 'generate_image' tool.
    
    PROTOCOL:
    1. **Evaluation**: Analyze if the request is for a SINGLE image or a SEQUENCE (e.g. "PPT deck", "Storyboard", "Comic strip", "3 variations").
    
    2. **Sequences (PPT/Comics/Storyboards)**:
       - **Planning**: Internally plan the content for each slide/panel.
       - **Consistency**: You MUST strictly maintain style consistency. Define a "Global Style String" (e.g. "Flat vector art, corporate blue palette") and append it to the prompt of EVERY image in the sequence.
       - **Execution**: You MUST issue MULTIPLE 'generate_image' tool calls in a SINGLE response. One tool call per slide/panel. Do not ask for confirmation between slides.
       - **Response**: Tell the user you are generating the full set (e.g. "Generating 5 slides for your PPT...").
    
    3. **Single Image**:
       - If vague (e.g., "draw a cat"), DO NOT call the tool. Ask clarifying questions about style/mood.
       - If detailed OR if user says "surprise me", call 'generate_image'.
    
    4. **Confirmation**: When calling tools, you MUST also reply to the user with a confirmation message explaining what you are doing. Never call the tool silently.
    
    [CRITICAL]: Do not simulate the tool. You must emit native tool calls.
    `;
  }

  const contextInjection = currentContextSummary ? `
  [LONG-TERM MEMORY]
  ${currentContextSummary}
  ` : "";

  const systemInstruction = `
    ${roleInstruction}
    ${contextInjection}
    INSTRUCTION: Provide direct, concise answers. Call tools when appropriate.
    `;

  const messageParts = messageToParts(currentMessage);
  const msgPayload = messageParts.length === 1 && messageParts[0].text ? messageParts[0].text : messageParts;

  const executeStream = async (targetModel: string, config: any, customHistory?: Content[]) => {
      const chat = ai.chats.create({
        model: targetModel,
        history: customHistory || historyContent,
        config: { systemInstruction, ...config }
      });

      const result = await chat.sendMessageStream({ 
        message: msgPayload
      });
      
      let fullText = '';
      let hasOpenedThought = false;
      let toolCallDetected = false;

      for await (const chunk of result) {
        if (signal?.aborted) break;

        // Check for Tool Calls in the chunk
        const candidates = chunk.candidates || [];
        if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
            for (const part of candidates[0].content.parts) {
                if (part.functionCall) {
                   // Found a tool call!
                   toolCallDetected = true;
                   
                   if (onToolCall) {
                       // We yield execution slightly to allow UI to render first
                       setTimeout(() => {
                           if (onToolCall) onToolCall({
                                toolName: part.functionCall!.name,
                                args: part.functionCall!.args
                           });
                       }, 0);
                   }
                   // We append a marker so UI knows a tool was used, but the UI component should strip this from view
                   fullText += `\n[Using Tool: ${part.functionCall.name}...]`; 
                }
                
                // Native Thinking
                if ((part as any).thought) {
                    if (!hasOpenedThought) { fullText += '<thought>'; hasOpenedThought = true; }
                    fullText += (part as any).thought;
                }
                
                if (part.text) {
                   if (hasOpenedThought && !(part as any).thought) { fullText += '</thought>'; hasOpenedThought = false; }
                   fullText += part.text;
                }
            }
        } else {
            const text = chunk.text;
            if (text) fullText += text;
        }

        onChunk(fullText);
      }
      
      if (hasOpenedThought) {
          fullText += '</thought>';
          onChunk(fullText);
      }
      
      // Safety: If tool called but no text, ensure we don't leave it completely blank or it might look stuck
      if (toolCallDetected && fullText.trim() === '') {
          fullText += '\n[Using Tool: generate_image...]'; 
          onChunk(fullText);
      }
      
      return fullText;
  };

  try {
      return await executeStream(apiModelName, modelConfig);
  } catch (err: any) {
      console.warn("Stream failed, trying fallback...", err);
      throw err;
  }
};