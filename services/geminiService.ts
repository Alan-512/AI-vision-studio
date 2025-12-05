import { GoogleGenAI, GenerateContentResponse, Content, Part } from "@google/genai";
import { GenerationParams, AspectRatio, ImageResolution, VideoResolution, AssetItem, ImageModel, ImageStyle, VideoStyle, VideoDuration, VideoModel, ChatMessage, ChatModel, AppMode } from "../types";

const USER_API_KEY_STORAGE_KEY = 'user_gemini_api_key';

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
          return new Error("Server is busy (Quota Exceeded). This usually means a previous video is still processing in the background. Please wait 1-2 minutes.");
        }
        if (parsed.error.message) {
          // If the inner message is the quota message, clean it up
          if (parsed.error.message.includes('quota') || parsed.error.message.includes('429')) {
             return new Error("Server is busy (Quota Exceeded). This usually means a previous video is still processing in the background. Please wait 1-2 minutes.");
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
      return new Error("Server is busy (Quota Exceeded). This usually means a previous video is still processing in the background. Please wait 1-2 minutes.");
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

export const optimizePrompt = async (originalPrompt: string, mode: AppMode): Promise<string> => {
  if (!originalPrompt.trim()) return "";
  
  const ai = getClient();
  
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
    
    Original Input: "${originalPrompt}"
    
    Output ONLY the refined prompt text. Do not add quotes.`;
  } else {
    task = `You are a professional Creative Director. 
    Enhance this image prompt with artistic details, lighting, composition, and texture. 
    Original Prompt: "${originalPrompt}"
    Output ONLY the refined prompt text. Keep it concise (under 60 words).`;
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
    // Use Flash for fast, cheap text generation
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
    // Convert history to text format
    const conversationText = history.map(msg => {
      const imgCount = (msg.images?.length || (msg.image ? 1 : 0));
      return `${msg.role}: ${msg.content} ${imgCount > 0 ? `[User uploaded ${imgCount} images]` : ''}`;
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

// Helper to convert ChatMessage to Google GenAI Content Part
const messageToParts = (msg: ChatMessage): Part[] => {
  const parts: Part[] = [];
  
  // Handle new multiple images array
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
  } 
  // Handle legacy single image
  else if (msg.image) {
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

  if (msg.content) {
    parts.push({ text: msg.content });
  }

  return parts;
};

export const streamChatResponse = async (
  history: ChatMessage[], 
  newMessage: string, 
  onChunk: (text: string) => void,
  model: ChatModel = ChatModel.GEMINI_3_PRO_FAST,
  mode: AppMode = AppMode.IMAGE,
  signal?: AbortSignal
): Promise<string> => {
  const ai = getClient();
  
  // Separate history into "past turns" and "current turn"
  const pastMessages = history.slice(0, history.length - 1);
  const currentMessage = history[history.length - 1];

  // Convert past history to Content[]
  const historyContent: Content[] = pastMessages.map(msg => ({
    role: msg.role,
    parts: messageToParts(msg)
  }));

  // Define logic for Models
  let apiModelName = 'gemini-2.5-flash'; 
  // Native Thinking Config
  let modelConfig: any = {};
  
  if (model === ChatModel.GEMINI_3_PRO_REASONING) {
    apiModelName = 'gemini-3-pro-preview';
    // Use native thinking configuration with explicit includeThoughts
    modelConfig = {
      thinkingConfig: {
        thinkingBudget: 16384, // Set a reasonable budget
        includeThoughts: true
      }
    };
  }
  
  // Base instructions
  const commonInstruction = `
  If the user uploads an image with RED BOXES, CIRCLES, or NUMBERED LABELS (e.g., "1", "2"):
  1. These are specific annotations marking areas the user wants to change or discuss.
  2. "Area 1" refers to the content inside the box labeled "1".
  3. When the user asks to "Change Area 1 to X", you must understand they want to keep the rest of the image exactly as is, but replace the content of that specific region.
  4. Your goal is to write a new, full ${mode === AppMode.VIDEO ? 'video' : 'image'} generation prompt that describes the scene *as if the change had already happened*.
  5. CRITICAL: Do NOT mention the red boxes, labels, or numbers in the final prompt description. The red boxes are only for communication; the final result should not have them.
  `;

  let roleInstruction = "";
  if (mode === AppMode.VIDEO) {
    roleInstruction = `You are a professional Film Director and Cinematographer (DoP) AI assistant.
    Your goal is to help the user brainstorm and refine prompts for VIDEO generation (using Google Veo).
    
    CRITICAL: You must always guide the user to provide the following structure for video prompts:
    (Subject + Action) + (Environment + Lighting) + (Camera Movement).
    
    If the user's prompt is too simple (e.g., "a cat"), you MUST ask:
    1. "What is the subject doing?" (Action)
    2. "How should the camera move?" (e.g., Drone shot, Pan, Zoom, Static)
    
    Always suggest specific camera terminology (e.g., "Low angle", "Tracking shot", "Slow motion").
    Ensure the description respects physical consistency.
    `;
  } else {
    roleInstruction = `You are a professional Creative Director and Digital Artist AI assistant. 
    Your goal is to help the user brainstorm and refine prompts for IMAGE generation.
    Focus on: Composition, Art Style, Lighting, Texture, and Details.
    `;
  }

  let systemInstruction = "";

  if (model === ChatModel.GEMINI_3_PRO_REASONING) {
    // REASONING MODEL (Native Thinking)
    systemInstruction = `
    ${roleInstruction}
    
    You are in "Reasoning Mode". Use your thinking capabilities to analyze the user's request in depth before providing the final answer.
    
    ${commonInstruction}
    `;
  } else {
    // FAST MODEL (Flash)
    systemInstruction = `
    ${roleInstruction}
    If the user uploads images, analyze them to help them. You can refer to multiple images.
    
    ${commonInstruction}

    INSTRUCTION:
    Provide direct, concise, and creative answers. 
    Focus on speed and immediate utility.
    `;
  }

  const chat = ai.chats.create({
    model: apiModelName,
    history: historyContent,
    config: {
      systemInstruction: systemInstruction,
      ...modelConfig // Inject thinkingConfig if enabled
    }
  });

  // Construct current message parts
  const messageParts = messageToParts(currentMessage);
  
  const result = await chat.sendMessageStream({ 
    message: messageParts.length === 1 && messageParts[0].text ? messageParts[0].text : messageParts
  });
  
  let fullText = '';
  let hasOpenedThought = false;

  for await (const chunk of result) {
    if (signal?.aborted) {
      break;
    }

    // NATIVE THINKING HANDLING
    const candidate = chunk.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        let thoughtPartText: string | undefined = undefined;
        
        const rawThought = (part as any).thought;
        if (typeof rawThought === 'string') {
          thoughtPartText = rawThought;
        } else if (rawThought === true && part.text) {
          thoughtPartText = part.text;
        }

        const textContent = part.text;

        if (thoughtPartText !== undefined) {
           if (!hasOpenedThought) {
              fullText += '<thought>';
              hasOpenedThought = true;
           }
           fullText += thoughtPartText;
        } else if (textContent) {
           // If we switch back to normal text and thought was open, close it
           if (hasOpenedThought) {
              fullText += '</thought>';
              hasOpenedThought = false;
           }
           fullText += textContent;
        }
      }
    } else {
        const text = chunk.text;
        if (text) {
          fullText += text;
        }
    }

    onChunk(fullText);
  }
  
  // Ensure thought tag is closed if stream ends while thinking
  if (hasOpenedThought) {
      fullText += '</thought>';
      onChunk(fullText);
  }
  
  return fullText;
};

export const testConnection = async (apiKey: string): Promise<void> => {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const apiCall = ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Ping',
    });
    
    // 10 second timeout for connectivity check
    const TIMEOUT_MS = 10000;
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Connection timed out (10s). Please check your network proxy or VPN.")), TIMEOUT_MS)
    );

    await Promise.race([apiCall, timeoutPromise]);
  } catch (error) {
    throw parseError(error);
  }
};

const getStyleSuffix = (style: ImageStyle | undefined): string => {
  switch (style) {
    case ImageStyle.MODERN_VECTOR:
      return "modern corporate flat vector illustration, google material design aesthetic, minimalist geometric shapes, clean lines, low saturation pastel color palette, airy and bright, soft lighting, subtle depth, negative space, visual balance, sophisticated design colors, abstract symbolism, vector art, 4k";
    case ImageStyle.PHOTOREALISTIC:
      return "photorealistic, 8k resolution, highly detailed, realistic texture, cinematic lighting, photography";
    case ImageStyle.ANIME:
      return "anime style, manga aesthetic, vibrant colors, studio ghibli style, detailed line art";
    case ImageStyle.DIGITAL_ART:
      return "digital art, concept art, trending on artstation, smooth illustration, highly detailed, vivid";
    case ImageStyle.COMIC_BOOK:
      return "comic book style, bold lines, halftone patterns, vibrant contrast, graphic novel aesthetic";
    case ImageStyle.WATERCOLOR:
      return "watercolor painting style, soft blending, artistic splatter, paper texture, wet-on-wet technique";
    case ImageStyle.THREE_D_RENDER:
      return "3D render, blender 3d, octane render, ray tracing, cute, isometric, soft lighting, 4k";
    case ImageStyle.CYBERPUNK:
      return "cyberpunk style, neon lights, futuristic city, high tech, dark atmosphere, glowing accents";
    case ImageStyle.PIXEL_ART:
      return "pixel art, 16-bit style, retro game aesthetic, sharp edges";
    case ImageStyle.SKETCH:
      return "pencil sketch, charcoal drawing, rough lines, artistic shading, monochrome, hand drawn";
    case ImageStyle.NONE:
    default:
      return "";
  }
};

const getVideoStyleSuffix = (style: VideoStyle | undefined): string => {
  switch (style) {
    case VideoStyle.CINEMATIC:
      return "cinematic lighting, high budget production, 35mm lens, film grain, color graded, ultra realistic";
    case VideoStyle.ANIME:
      return "anime style, vibrant colors, studio ghibli art style, high quality animation";
    case VideoStyle.VINTAGE:
      return "vintage film look, 8mm film texture, sepia tone, dust and scratches, retro aesthetic";
    case VideoStyle.CYBERPUNK:
      return "cyberpunk city, neon lights, futuristic, high tech, night time, rain, glowing reflections";
    case VideoStyle.NATURE:
      return "national geographic style, nature documentary, 4k wildlife photography, highly detailed, natural lighting";
    case VideoStyle.DRONE:
      return "aerial drone shot, wide angle, smooth camera movement, bird's eye view, high altitude";
    case VideoStyle.GLITCH:
      return "digital glitch art, datamoshing, signal distortion, vhs static, abstract visual effects";
    case VideoStyle.THREE_D:
      return "3D animation, pixar style, claymation, smooth rendering, bright colors";
    case VideoStyle.NONE:
    default:
      return "";
  }
};

export const generateImage = async (params: GenerationParams, projectId: string, onStart?: () => void, signal?: AbortSignal): Promise<AssetItem> => {
  // Wrap in Queue
  return imageQueue.add(async () => {
    // Check abort before start
    if (signal?.aborted) throw new Error("Cancelled");

    const ai = getClient();
    const modelName = params.imageModel;
    const isPro = modelName === ImageModel.PRO;
    
    // Check if simple editing mode
    const isEditing = !!(params.referenceImage && params.referenceImageMimeType) && 
                      (!params.styleReferences || params.styleReferences.length === 0) &&
                      (!params.subjectReferences || params.subjectReferences.length === 0);

    let systemInstruction = "You are a pure image generation engine. Your ONLY purpose is to generate an image based on the prompt. Do NOT generate conversational text, markdown, or explanations (e.g., 'Here is the image', 'Sure'). Output ONLY the image.";

    if (params.negativePrompt) {
       systemInstruction += `\n\nNEGATIVE PROMPT / EXCLUSIONS: The user explicitly wants to avoid the following elements: "${params.negativePrompt}". Ensure the generated image does NOT contain these elements.`;
    }

    const config: any = {
      imageConfig: {
        numberOfImages: 1,
      },
      systemInstruction: systemInstruction
    };

    if (params.seed !== undefined) {
      config.seed = params.seed;
    }

    if (!isEditing) {
      config.imageConfig.aspectRatio = params.aspectRatio;
    }

    if (isPro && params.imageResolution) {
      config.imageConfig.imageSize = params.imageResolution;
    }

    const parts: any[] = [];
    let finalPrompt = params.prompt;
    let promptPrefix = "";
    
    // --- SANDWICH LOGIC: Subject + Composition + Style ---
    
    // 1. SUBJECT REFERENCES (Identity)
    if (params.subjectReferences && params.subjectReferences.length > 0) {
        promptPrefix += `\n[SUBJECT IDENTITY]: The user has provided ${params.subjectReferences.length} reference image(s) for the MAIN SUBJECT. `;
        promptPrefix += `You MUST maintain the exact identity, facial features, and appearance of the ${params.subjectType || 'Subject'} in these images. `;
        promptPrefix += `Do NOT change the physical characteristics of the subject.\n`;
        
        params.subjectReferences.forEach(ref => {
           parts.push({
             inlineData: { mimeType: ref.mimeType, data: ref.data }
           });
        });
    }

    // 2. STYLE REFERENCES (Vibe)
    if (params.styleReferences && params.styleReferences.length > 0) {
       promptPrefix += `\n[ARTISTIC STYLE]: The user has provided ${params.styleReferences.length} reference image(s) for STYLE. `;
       promptPrefix += `Use these images primarily for COLOR PALETTE, TEXTURE, ARTISTIC STYLE, and LIGHTING. `;
       promptPrefix += `Do not copy the exact composition of these style images. Apply this style to the subject.\n`;
       
       params.styleReferences.forEach(ref => {
         parts.push({
           inlineData: { mimeType: ref.mimeType, data: ref.data }
         });
       });
    }

    // 3. COMPOSITION / BASE IMAGE (Structure)
    if (params.referenceImage && params.referenceImageMimeType) {
       // Check for annotations first
       if (params.isAnnotatedReference) {
          promptPrefix += `\n[EDITING INSTRUCTION]: The input image contains artificial RED BOUNDING BOXES. `;
          promptPrefix += `Edit ONLY the content INSIDE the red boxes based on the prompt. `;
          promptPrefix += `COMPLETELY REMOVE all red boxes and numbers. Seamlessly inpaint the area.\n`;
       } else {
          promptPrefix += `\n[COMPOSITION / STRUCTURE]: The user has provided a BASE IMAGE. `;
          promptPrefix += `Use this image for the POSE, LAYOUT, DEPTH, and COMPOSITION of the scene. `;
          promptPrefix += `Maintain the visual structure of this base image, but render it with the Subject and Style defined above.\n`;
       }

       parts.push({
         inlineData: {
           mimeType: params.referenceImageMimeType,
           data: params.referenceImage
         }
       });
    }

    // --- TEXT RENDERING INSTRUCTION ---
    if (params.textToRender) {
       promptPrefix += `\n[TEXT RENDER REQUIREMENT]: You MUST render the following text clearly and legibly in the image: "${params.textToRender}". Ensure spelling is exact.\n`;
    }

    // Combine Prefix + User Prompt
    if (promptPrefix) {
        finalPrompt = `${promptPrefix}\n\n[USER PROMPT]: ${finalPrompt}`;
    }

    const styleSuffix = getStyleSuffix(params.imageStyle);
    if (styleSuffix) {
      finalPrompt = `${finalPrompt} . Style description: ${styleSuffix}`;
    }

    parts.push({ text: finalPrompt });

    try {
      const apiCall = ai.models.generateContent({
        model: modelName,
        contents: {
          parts: parts
        },
        config: config
      });

      // Increase timeout to 900 seconds (15 minutes) for Pro model
      const TIMEOUT_MS = 900000;
      const timeoutPromise = new Promise<GenerateContentResponse>((_, reject) => 
        setTimeout(() => reject(new Error(`Request timed out after ${TIMEOUT_MS/1000} seconds`)), TIMEOUT_MS)
      );

      // Abort Promise
      const abortPromise = new Promise<GenerateContentResponse>((_, reject) => {
        if (signal) {
          if (signal.aborted) reject(new Error("Cancelled"));
          signal.addEventListener('abort', () => reject(new Error("Cancelled")));
        }
      });

      // Race API call with timeout and cancellation
      const response = await Promise.race([
        apiCall, 
        timeoutPromise, 
        ...(signal ? [abortPromise] : [])
      ]);

      if (response.promptFeedback?.blockReason) {
        throw new Error(`Generation blocked: ${response.promptFeedback.blockReason}`);
      }
      
      const candidate = response.candidates?.[0];
      
      // CRITICAL FIX: Robust Safety & Empty Check
      if (!candidate) {
          throw new Error("API returned no candidates. The request might have been blocked or the model is overloaded.");
      }

      // 1. Check Finish Reason
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
         const safetyRating = candidate.safetyRatings?.find(r => r.probability !== 'NEGLIGIBLE');
         if (safetyRating) {
             throw new Error(`Generation flagged for safety (${safetyRating.category}). Please modify your prompt.`);
         }
         if (candidate.finishReason === 'SAFETY') {
             throw new Error("Generation blocked by safety filters. Please try a different prompt.");
         }
         throw new Error(`Generation stopped by model: ${candidate.finishReason}`);
      }

      // 2. Check Content Existence
      if (!candidate.content?.parts || candidate.content.parts.length === 0) {
         throw new Error("Model returned empty content. This usually indicates a safety block.");
      }

      let imageUrl = '';
      if (candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData) {
            const mimeType = part.inlineData.mimeType || 'image/png';
            imageUrl = `data:${mimeType};base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      if (!imageUrl) {
        const textFeedback = candidate.content.parts[0]?.text;
        if (textFeedback) {
          throw new Error(`Model returned text instead of image: ${textFeedback.substring(0, 100)}...`);
        }
        
        throw new Error("No image data returned from API. Please try a different prompt or model.");
      }

      return {
        id: crypto.randomUUID(),
        projectId: projectId,
        type: 'IMAGE',
        url: imageUrl,
        prompt: params.prompt,
        createdAt: Date.now(),
        status: 'COMPLETED',
        metadata: {
          aspectRatio: params.aspectRatio,
          model: modelName,
          style: params.imageStyle !== ImageStyle.NONE ? params.imageStyle : undefined,
          resolution: params.imageResolution
        }
      };

    } catch (error) {
      console.error("Image Generation Failed:", error);
      throw parseError(error);
    }
  }, onStart);
};

// Variable to track last video generation time (RPM Protection)
let lastVideoRequestTime = 0;
// Circuit Breaker State
let videoCircuitBreakerEndTime = 0;

// HELPER: Polling & Downloading Logic
// Used by both initial generation and resume
const pollAndDownloadVideo = async (
  ai: GoogleGenAI, 
  operation: any, 
  signal?: AbortSignal
): Promise<string> => {
    
    let currentOp = operation;
    const startTime = Date.now();
    const TIMEOUT_MS = 900000; // 15 minutes timeout
    
    // 1. Polling Loop
    while (!currentOp.done) {
        if (signal?.aborted) throw new Error("Cancelled");
        
        if (Date.now() - startTime > TIMEOUT_MS) { 
          throw new Error("Video generation timed out");
        }
        // 10s polling interval
        await new Promise(resolve => setTimeout(resolve, 10000));
        currentOp = await ai.operations.getVideosOperation({ operation: currentOp });
    }

    if (currentOp.error) {
        throw new Error(currentOp.error.message || "Video generation failed");
    }

    // 2. Download with Fallback Strategy
    const videoUri = currentOp.response?.generatedVideos?.[0]?.video?.uri;
    if (!videoUri) throw new Error("No video URI returned");

    const userKey = getUserApiKey();
    const envKey = process.env.API_KEY;
    const activeKey = (userKey || envKey || '').trim();

    if (!activeKey) throw new Error("API Key missing during download.");

    // Strategy 1: URL Parameter (Standard)
    try {
        const url = new URL(videoUri);
        url.searchParams.set('key', activeKey);
        // Explicitly set alt=media just in case
        if (!url.searchParams.has('alt')) {
            url.searchParams.set('alt', 'media');
        }
        
        const res = await fetch(url.toString(), { referrerPolicy: 'no-referrer' });
        if (res.ok) {
             const blob = await res.blob();
             return URL.createObjectURL(blob);
        }
        // If 403, throw to catch block to try next strategy
        if (res.status === 403) throw new Error("403 Forbidden via URL");
    } catch (e) {
        console.warn("Download Strategy 1 failed, trying Strategy 2...", e);
    }

    // Strategy 2: Header Authentication (Fallback)
    try {
        const url = new URL(videoUri);
        url.searchParams.delete('key'); // Clean URL
        if (!url.searchParams.has('alt')) {
            url.searchParams.set('alt', 'media');
        }
        
        const res = await fetch(url.toString(), { 
            headers: { 
                'x-goog-api-key': activeKey 
            },
            referrerPolicy: 'no-referrer'
        });
        
        if (res.ok) {
             const blob = await res.blob();
             return URL.createObjectURL(blob);
        }
        throw new Error(`Download failed with status: ${res.status}`);
    } catch (e: any) {
        console.error("All download strategies failed", e);
        throw new Error(`Failed to download video: ${e.message || "Unknown Error"}`);
    }
};

// Video Generation now returns the URL string on success
// It takes a callback to notify caller about the Operation ID
export const generateVideo = async (
    params: GenerationParams, 
    onOperationCreated?: (opName: string) => void, 
    onStart?: () => void, 
    signal?: AbortSignal
): Promise<string> => { // Returns Blob URL string directly
  
  // Wrap in Queue
  return videoQueue.add(async () => {
    // Check abort before start
    if (signal?.aborted) throw new Error("Cancelled");
    
    // 1. CIRCUIT BREAKER CHECK
    if (Date.now() < videoCircuitBreakerEndTime) {
       const remaining = Math.ceil((videoCircuitBreakerEndTime - Date.now()) / 1000);
       throw new Error(`System Cooling Down: Google Server is busy processing a previous request. Please wait ${remaining} seconds.`);
    }

    // 2. Client-side RPM Protection: Enforce 15s cooldown between starts
    const now = Date.now();
    if (now - lastVideoRequestTime < 15000) {
         const waitTime = Math.ceil((15000 - (now - lastVideoRequestTime)) / 1000);
         throw new Error(`Rate Limit Protection: Please wait ${waitTime} seconds before starting another video to avoid server rejection.`);
    }
    
    const ai = getClient();
    const modelName = params.videoModel; 

    try {
      if (onStart) onStart();

      let finalPrompt = params.prompt;
      
      const styleSuffix = getVideoStyleSuffix(params.videoStyle);
      if (styleSuffix) {
        finalPrompt = `${finalPrompt} . ${styleSuffix}`;
      }
      
      if (params.negativePrompt) {
         finalPrompt += ` . Exclude/Negative: ${params.negativePrompt}`;
      }

      if (params.videoDuration === VideoDuration.LONG) {
         finalPrompt += " . long shot, extended duration, continuous take";
      }

      const request: any = {
        model: modelName,
        prompt: finalPrompt,
        config: {
          numberOfVideos: 1,
          resolution: params.videoResolution || VideoResolution.RES_720P,
          aspectRatio: params.aspectRatio === AspectRatio.PORTRAIT ? '9:16' : '16:9'
        }
      };

      if (params.videoStartImage && params.videoStartImageMimeType) {
        request.image = {
          imageBytes: params.videoStartImage,
          mimeType: params.videoStartImageMimeType
        };
      }

      if (params.videoEndImage && params.videoEndImageMimeType) {
        request.config.lastFrame = {
          imageBytes: params.videoEndImage,
          mimeType: params.videoEndImageMimeType
        };
      }

      // 3. Start Generation
      const operation = await ai.models.generateVideos(request);
      
      // Update timestamp
      lastVideoRequestTime = Date.now();
      
      // Notify caller about Operation ID immediately
      if (operation.name && onOperationCreated) {
          onOperationCreated(operation.name);
      }

      // 4. Poll & Download
      return await pollAndDownloadVideo(ai, operation, signal);

    } catch (error: any) {
      console.error("Video Generation Failed:", error);
      
      const parsed = parseError(error);
      const msg = parsed.message;
      
      // Trip Circuit Breaker on 429
      if (msg.includes('Quota') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
         videoCircuitBreakerEndTime = Date.now() + 60000; 
      }
      
      throw parsed;
    }
  });
};

// New Function: Resume existing operation
export const resumeVideoGeneration = async (operationName: string): Promise<string> => {
    // We do NOT use the queue for resumes to prevent blocking new requests unnecessarily
    // The task is already running on Google's side
    const ai = getClient();
    try {
        // Construct minimal operation object
        const operation = { name: operationName, done: false };
        return await pollAndDownloadVideo(ai, operation);
    } catch (error: any) {
        console.error("Resume Video Failed:", error);
        throw parseError(error);
    }
};