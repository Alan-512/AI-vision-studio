

import { GoogleGenAI, GenerateContentResponse, Content, Part } from "@google/genai";
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
    
    // SAFETY FIX: Limit context to last 20 messages to prevent "413 Payload Too Large" or Token limits on extraction
    const recentHistory = history.slice(-20);

    // Convert history to text format
    const conversationText = recentHistory.map(msg => {
      const imgCount = (msg.images?.length || (msg.image ? 1 : 0));
      // CLEAN THOUGHTS from extraction context too, just in case
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

// --- RECURSIVE ROLLING SUMMARY ---
// Updates the "contextSummary" by adding the new "delta" lines.
// This ensures that the context size remains constant (Summary + Active Window) regardless of history length.
const updateRecursiveSummary = async (
    currentSummary: string, 
    newMessages: ChatMessage[]
): Promise<string> => {
  if (newMessages.length === 0) return currentSummary;
  
  const ai = getClient();
  
  // Extract text only, representing images as tokens to save space
  const deltaText = newMessages.map(m => {
     // Remove thought tags
     const cleanContent = m.content.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
     
     // Handle image markers
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
  - If the user uploaded images, note their context (e.g., "User uploaded a reference for a cyberpunk city").
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

  // CRITICAL FIX: Robust handling for text content.
  if (msg.content && msg.content.trim() !== "") {
    parts.push({ text: msg.content });
  } else {
    // Empty or undefined content.
    // Always push a space if we haven't pushed text yet, to satisfy API requirements.
    parts.push({ text: " " });
  }

  return parts;
};

// Helper function to build history with strict alternation
// UPDATED: Now supports Smart Image Retention (keeping only last N images)
const buildHistoryContent = (pastMessages: ChatMessage[], maxImagesToKeep: number = 3): Content[] => {
  const historyContent: Content[] = [];
  let lastRole: string | null = null;
  
  // Logic to identify which messages should keep their images.
  // We iterate backwards to find the indices of the last N user messages that have images.
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

  // Build content
  for (let i = 0; i < pastMessages.length; i++) {
    const msg = pastMessages[i];
    let parts: Part[] = [];

    // If this message has images but is NOT in the allowed list, we strip the images
    // and replace them with a text placeholder to save bandwidth/tokens.
    const hasImage = (msg.images && msg.images.length > 0) || !!msg.image;
    
    if (hasImage && !allowedImageIndices.has(i)) {
       // Strip logic
       if (msg.content && msg.content.trim() !== "") {
           parts.push({ text: msg.content + "\n\n[System: Older image attachments removed to conserve context window. Focus on recent images.]" });
       } else {
           parts.push({ text: "[System: Older image attachments removed to conserve context window.]" });
       }
    } else {
       // Keep original logic
       parts = messageToParts(msg);
    }
    
    // If model message, strip thoughts from history
    if (msg.role === 'model') {
       parts = parts.map(p => {
           if (p.text) {
               // Remove <thought> tags and content
               const cleanedText = p.text.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
               return cleanedText.length > 0 ? { ...p, text: cleanedText } : { ...p, text: " " };
           }
           return p;
       });
    }
    
    // Filter out parts that might be effectively empty but keep the structure valid
    const validParts = parts.filter(p => p.inlineData || (p.text && p.text.trim().length >= 0));

    if (validParts.length > 0) {
        // STATE MACHINE CHECK:
        // If current message role matches last role, we have a violation.
        // Insert a dummy turn to bridge the gap.
        if (lastRole === msg.role) {
            if (msg.role === 'user') {
                // User -> User detected. Insert Model.
                historyContent.push({ role: 'model', parts: [{ text: " " }] });
            } else {
                // Model -> Model detected. Insert User.
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

  // REPAIR TAIL:
  // History passed to API must end with 'model' if the next message we send is 'user'.
  if (historyContent.length > 0 && historyContent[historyContent.length - 1].role === 'user') {
      historyContent.push({ role: 'model', parts: [{ text: " " }] });
  }

  return historyContent;
};

// Helper: Sanitize history by removing ALL image data (text only)
// Used for Last-Resort Recovery to fix "Poisoned Image" errors
const sanitizeHistoryForTextOnly = (originalHistory: Content[]): Content[] => {
    return originalHistory.map(item => {
        // Filter parts to keep ONLY text
        const textParts = item.parts.filter(p => p.text);
        
        // If message becomes empty (it was image-only), insert explicit placeholder
        if (textParts.length === 0) {
            return { 
                role: item.role, 
                parts: [{ text: "[Image content removed for compatibility]" }] 
            };
        }
        return { role: item.role, parts: textParts };
    });
};

export const streamChatResponse = async (
  history: ChatMessage[], 
  newMessage: string, 
  onChunk: (text: string) => void,
  model: ChatModel = ChatModel.GEMINI_3_PRO_FAST,
  mode: AppMode = AppMode.IMAGE,
  signal?: AbortSignal,
  // --- NEW RECURSIVE SUMMARY PROPS ---
  projectContextSummary?: string,
  projectSummaryCursor?: number,
  onUpdateContext?: (newSummary: string, newCursor: number) => void
): Promise<string> => {
  const ai = getClient();
  
  // Defines the "Active Window" size (most recent messages sent fully to LLM)
  const MAX_ACTIVE_WINDOW = 12;

  // 1. RECURSIVE SUMMARY UPDATE
  // Before chatting, check if we need to archive some messages into the summary
  // Logic: If there are messages between [cursor] and [end - MAX_ACTIVE], they need summarizing
  let currentContextSummary = projectContextSummary || "";
  let currentCursor = projectSummaryCursor || 0;
  
  // history already includes the new user message at the end
  // We want to verify if 'history' has grown enough to trigger a summary
  // We exclude the very last user message from the "archive candidate" calculation
  const historyLen = history.length;
  // Calculate the index where the "Active Window" begins
  // Everything before this index is eligible for archiving
  const archiveBoundary = Math.max(0, historyLen - 1 - MAX_ACTIVE_WINDOW);

  if (archiveBoundary > currentCursor) {
      // We have a "Delta" of unsummarized messages
      const deltaMessages = history.slice(currentCursor, archiveBoundary);
      
      try {
          // Perform Incremental Summary (Fire & Forget or Await? Await ensures context is fresh)
          console.log(`[Summary] Rolling up ${deltaMessages.length} messages into context...`);
          currentContextSummary = await updateRecursiveSummary(currentContextSummary, deltaMessages);
          
          // Update the cursor
          currentCursor = archiveBoundary;

          // Notify App to save the new summary state to DB
          if (onUpdateContext) {
              onUpdateContext(currentContextSummary, currentCursor);
          }
      } catch (e) {
          console.warn("Failed to update recursive summary, continuing with old context", e);
      }
  }

  // 2. BUILD ACTIVE HISTORY
  // We only send the "Active Window" + New Message to the LLM
  // We slice from the cursor (which is usually archiveBoundary, but might be 0 if short history)
  // Actually, for safety, let's just take the last MAX_ACTIVE_WINDOW messages
  // Because even if we summarized them, sending a bit of overlap is safer than a gap
  const activeMessages = history.slice(-MAX_ACTIVE_WINDOW - 1, -1); // Exclude current new message
  const currentMessage = history[history.length - 1];

  // Ensure Active History starts with 'user' (API Constraint)
  let validActiveMessages = [...activeMessages];
  if (validActiveMessages.length > 0 && validActiveMessages[0].role === 'model') {
       validActiveMessages.shift(); // Drop orphaned model message
  }

  // Pass maxImagesToKeep = 3 (Safe retention strategy)
  const historyContent = buildHistoryContent(validActiveMessages, 3);

  // Define logic for Models
  let apiModelName = 'gemini-2.5-flash'; 
  let modelConfig: any = {};
  
  if (model === ChatModel.GEMINI_3_PRO_REASONING) {
    apiModelName = 'gemini-3-pro-preview';
    modelConfig = {
      thinkingConfig: {
        thinkingBudget: 16384, 
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

  // --- INJECT RECURSIVE CONTEXT INTO SYSTEM INSTRUCTION ---
  let systemInstruction = "";
  let flashSystemInstruction = ""; 

  // Format the persistent summary clearly
  const contextInjection = currentContextSummary ? `
  
  [LONG-TERM MEMORY & CONTEXT]
  The following is a summary of the previous conversation. Use this to maintain context about user preferences and project goals.
  -----------------------
  ${currentContextSummary}
  -----------------------
  ` : "";

  flashSystemInstruction = `
    ${roleInstruction}
    If the user uploads images, analyze them to help them. You can refer to multiple images.
    
    ${commonInstruction}
    ${contextInjection}

    INSTRUCTION:
    Provide direct, concise, and creative answers. 
    Focus on speed and immediate utility.
    `;

  if (model === ChatModel.GEMINI_3_PRO_REASONING) {
    // REASONING MODEL (Native Thinking)
    systemInstruction = `
    ${roleInstruction}
    
    You are in "Reasoning Mode". Use your thinking capabilities to analyze the user's request in depth before providing the final answer.
    
    ${commonInstruction}
    ${contextInjection}
    `;
  } else {
    // FAST MODEL (Flash)
    systemInstruction = flashSystemInstruction;
  }

  const messageParts = messageToParts(currentMessage);
  // Ensure we pass the correct structure (String or Part[])
  const msgPayload = messageParts.length === 1 && messageParts[0].text ? messageParts[0].text : messageParts;

  // -- INTERNAL STREAM FUNCTION --
  const executeStream = async (targetModel: string, config: any, customHistory?: Content[]) => {
      const chat = ai.chats.create({
        model: targetModel,
        history: customHistory || historyContent,
        config: config
      });

      const result = await chat.sendMessageStream({ 
        message: msgPayload
      });
      
      let fullText = '';
      let hasOpenedThought = false;
      let chunkCount = 0;

      for await (const chunk of result) {
        if (signal?.aborted) break;
        chunkCount++;

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
               if (hasOpenedThought) {
                  fullText += '</thought>';
                  hasOpenedThought = false;
               }
               fullText += textContent;
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
      
      // CRITICAL CHECK: Enforce response validity.
      if (!fullText.trim()) {
          throw new Error("Model returned empty response (Possible Safety Filter or Silent Failure).");
      }

      return fullText;
  };

  try {
      // 1. Attempt Primary Request (User Choice + Full History)
      return await executeStream(apiModelName, {
        systemInstruction: systemInstruction,
        ...modelConfig 
      });

  } catch (err: any) {
      // 2. First Fallback: Switch to Flash + Full History
      console.warn("Primary model failed, attempting fallback to Flash...", err);
      
      try {
         return await executeStream('gemini-2.5-flash', {
            systemInstruction: flashSystemInstruction
         });
      } catch (fallbackErr) {
         // 3. Second Fallback: Switch to Flash + Text-Only History
         console.warn("Flash fallback with images failed. Attempting Text-Only Recovery...", fallbackErr);
         
         try {
             const cleanHistory = sanitizeHistoryForTextOnly(historyContent);
             return await executeStream('gemini-2.5-flash', {
                systemInstruction: flashSystemInstruction
             }, cleanHistory); 
         } catch (finalErr) {
             console.error("All recovery attempts failed:", finalErr);
             throw err; // Throw ORIGINAL error to show the root cause
         }
      }
  }
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

// Helper: Construct full description for a Smart Asset
const getSmartAssetDescription = (asset: SmartAsset): string => {
    // Resolve tags to English
    const tags = asset.selectedTags?.map(t => TAG_TO_ENGLISH[t] || t) || [];
    
    // Combine tags with custom label
    const parts = [...tags];
    if (asset.label) {
        parts.push(asset.label);
    }
    
    const desc = parts.join(', ');
    return desc ? `[${desc}] ` : '';
};

export const generateImage = async (params: GenerationParams, projectId: string, onStart?: () => void, signal?: AbortSignal, customId?: string): Promise<AssetItem> => {
  // Wrap in Queue
  return imageQueue.add(async () => {
    // Check abort before start
    if (signal?.aborted) throw new Error("Cancelled");

    const ai = getClient();
    const modelName = params.imageModel;
    const isPro = modelName === ImageModel.PRO;
    
    // Check if simple editing mode (only relevant for legacy or single annotated reference usage)
    // Note: The new Smart Assets logic is preferred, but this check remains for robustness.
    const isEditing = !!(params.referenceImage && params.referenceImageMimeType) && 
                      (!params.styleReferences || params.styleReferences.length === 0) &&
                      (!params.subjectReferences || params.subjectReferences.length === 0) &&
                      (!params.smartAssets || params.smartAssets.length === 0);

    // ENHANCED SYSTEM INSTRUCTION: Strict Priority Rules
    let systemInstruction = `
    You are a professional image generation engine.
    
    CRITICAL PRIORITY RULES (Order of Importance):
    1. [STRUCTURAL COMPOSITION BASE]: If provided, this image defines the NON-NEGOTIABLE GEOMETRY/SKELETON of the scene. You must replicate its layout, perspective, and depth exactly.
    2. [SUBJECT IDENTITY]: If provided, the character/object identity must be preserved strictly.
    3. [STYLE REFERENCE]: These are for COLORS, TEXTURE, and LIGHTING ONLY. You are ABSOLUTELY FORBIDDEN from copying the scene content, objects, or background from style reference images. They are NOT the subject.
    4. [USER PROMPT]: Describes the specific content details to render within the established structure.
    
    Output ONLY the image. Do NOT generate text.
    `;

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
    
    // Use Grounding (Google Search) - Only for Pro model
    if (isPro && params.useGrounding) {
        config.tools = [{ googleSearch: {} }];
    }

    if (!isEditing) {
      config.imageConfig.aspectRatio = params.aspectRatio;
    }

    if (isPro && params.imageResolution) {
      config.imageConfig.imageSize = params.imageResolution;
    }

    const parts: any[] = [];
    let finalPrompt = params.prompt;
    
    // --- SMART ASSETS LOGIC (Unified References) ---
    // If smartAssets exist, use them. Otherwise fall back to legacy fields.
    
    if (params.smartAssets && params.smartAssets.length > 0) {
        
        // 1. Structure (Layout)
        const structures = params.smartAssets.filter(a => a.type === 'STRUCTURE');
        structures.forEach(asset => {
            const labelStr = getSmartAssetDescription(asset);
            if (asset.isAnnotated) {
                // Inpainting / Annotated logic
                parts.push({ 
                    text: `[TASK: PRECISION EDITING] The following image ${labelStr}contains RED MARKERS or BRUSH STROKES. Locate these markers and regenerate ONLY the marked areas based on the user prompt. BLEND seamlessy. Negative constraint: No red markers in output.` 
                });
            } else {
                parts.push({ 
                    text: `[STRUCTURAL COMPOSITION BASE] ${labelStr}: The following image is the STRUCTURAL GROUND TRUTH. Replicate its geometry, layout, and perspective exactly.` 
                });
            }
            parts.push({ inlineData: { mimeType: asset.mimeType, data: asset.data } });
        });

        // 2. Identity (Subject)
        const identities = params.smartAssets.filter(a => a.type === 'IDENTITY');
        identities.forEach(asset => {
            const labelStr = getSmartAssetDescription(asset);
            parts.push({ 
                text: `[SUBJECT IDENTITY REFERENCE] ${labelStr}: This image defines a specific subject/object. Maintain its physical features, face, and appearance strictly.` 
            });
            parts.push({ inlineData: { mimeType: asset.mimeType, data: asset.data } });
        });

        // 3. Style
        const styles = params.smartAssets.filter(a => a.type === 'STYLE');
        styles.forEach(asset => {
            const labelStr = getSmartAssetDescription(asset);
            parts.push({ 
                text: `[STYLE REFERENCE ONLY] ${labelStr}: Use this image for COLORS, LIGHTING, and TEXTURE only. Do NOT copy the content.` 
            });
            parts.push({ inlineData: { mimeType: asset.mimeType, data: asset.data } });
        });

    } else {
        // --- LEGACY LOGIC FALLBACK ---
        
        // 1. STYLE REFERENCES
        if (params.styleReferences && params.styleReferences.length > 0) {
           parts.push({ text: `[STYLE REFERENCE IMAGES]: The following images are for STYLE ONLY.` });
           params.styleReferences.forEach(ref => {
             parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
           });
        }

        // 2. SUBJECT REFERENCES
        if (params.subjectReferences && params.subjectReferences.length > 0) {
            parts.push({ text: `[SUBJECT IDENTITY IMAGES]: The following images define the MAIN SUBJECT (${params.subjectType || 'Subject'}). Maintain identity.` });
            params.subjectReferences.forEach(ref => {
               parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
            });
        }

        // 3. COMPOSITION / BASE IMAGE
        if (params.referenceImage && params.referenceImageMimeType) {
           if (params.isAnnotatedReference) {
              parts.push({ text: `[TASK: INPAINTING] The following image has RED MARKERS. Regenerate marked areas based on prompt.` });
           } else {
              parts.push({ text: `[STRUCTURAL BASE] Use this image for layout and geometry.` });
           }
           
           // Handle Dual Reference Legacy
           if (params.originalReferenceImage) {
               parts.push({ text: `[ORIGINAL CLEAN IMAGE]`});
               parts.push({ inlineData: { mimeType: params.originalReferenceImageMimeType!, data: params.originalReferenceImage }});
               parts.push({ text: `[MASKED IMAGE]`});
           }
           
           parts.push({ inlineData: { mimeType: params.referenceImageMimeType, data: params.referenceImage } });
        }
    }

    // --- FINAL USER PROMPT CONSTRUCTION ---
    
    // Add text rendering requirement if exists
    let textRenderInstr = "";
    if (params.textToRender) {
       textRenderInstr = `\n\n[TEXT RENDER REQUIREMENT]: You MUST render the following text clearly and legibly in the image: "${params.textToRender}". Ensure spelling is exact.`;
    }

    // Append Style Suffix
    const styleSuffix = getStyleSuffix(params.imageStyle);
    if (styleSuffix) {
      finalPrompt = `${finalPrompt} . Style description: ${styleSuffix}`;
    }

    // Final Prompt Part
    const fullPromptText = `[USER PROMPT]: ${finalPrompt}${textRenderInstr}`;
    parts.push({ text: fullPromptText });

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
        id: customId || crypto.randomUUID(), // Use customId if provided to prevent pop-in
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
          resolution: params.imageResolution,
          seed: params.seed,
          usedGrounding: params.useGrounding // Store metadata
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

    try {
        const url = new URL(videoUri);
        // SECURITY FIX: Remove 'key' from URL params to prevent leakage in history/logs
        url.searchParams.delete('key'); 
        if (!url.searchParams.has('alt')) {
            url.searchParams.set('alt', 'media');
        }
        
        // Use Header-based authentication (Safer)
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
        
        // Fallback for some proxies that strip headers (Last Resort)
        // Only if 403 Forbidden with headers
        if (res.status === 403) {
            console.warn("Header auth failed (403), trying URL param fallback...");
            const fallbackUrl = new URL(videoUri);
            fallbackUrl.searchParams.set('key', activeKey);
            if (!fallbackUrl.searchParams.has('alt')) fallbackUrl.searchParams.set('alt', 'media');
            
            const fallbackRes = await fetch(fallbackUrl.toString(), { referrerPolicy: 'no-referrer' });
            if (fallbackRes.ok) {
                 const blob = await fallbackRes.blob();
                 return URL.createObjectURL(blob);
            }
        }
        
        throw new Error(`Download failed with status: ${res.status}`);
    } catch (e: any) {
        console.error("Video download failed", e);
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
    const isHQ = modelName === VideoModel.VEO_HQ;
    const isExtension = !!params.inputVideoData;

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

      // --- SCENARIO 1: VIDEO EXTENSION (Highest Priority) ---
      if (isExtension) {
          request.video = {
              videoBytes: params.inputVideoData, // Base64
              mimeType: params.inputVideoMimeType || 'video/mp4'
          };
          // Force resolution/aspect match usually, but Veo is strict.
          // We rely on user settings matching source, or trust API to handle minor mismatch.
          // Note: Extension ignores 'image' (start frame).
      } 
      // --- SCENARIO 2: STYLE REFERENCE (HQ Only) ---
      else if (isHQ && params.videoStyleReferences && params.videoStyleReferences.length > 0) {
          const refImagesPayload = params.videoStyleReferences.map(ref => ({
              image: {
                  imageBytes: ref.data,
                  mimeType: ref.mimeType
              },
              referenceType: 'ASSET'
          }));
          
          request.config.referenceImages = refImagesPayload;
          
          // Style Ref requires specific resolution (usually 720p)
          request.config.resolution = '720p'; 
      }
      // --- SCENARIO 3: KEYFRAMES (Start/End) ---
      else {
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
