
export enum AppMode {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  GALLERY = 'GALLERY'
}

export enum AspectRatio {
  SQUARE = '1:1',
  LANDSCAPE = '16:9',
  PORTRAIT = '9:16',
  FOUR_THIRDS = '4:3',
  THREE_FOURTHS = '3:4'
}

export enum ImageResolution {
  RES_1K = '1K',
  RES_2K = '2K', // Requires Pro
  RES_4K = '4K'  // Requires Pro
}

export enum VideoResolution {
  RES_720P = '720p',
  RES_1080P = '1080p'
}

export enum ImageModel {
  FLASH = 'gemini-2.5-flash-image',
  PRO = 'gemini-3-pro-image-preview'
}

export enum VideoModel {
  VEO_FAST = 'veo-3.1-fast-generate-preview',
  VEO_HQ = 'veo-3.1-generate-preview'
}

export enum ChatModel {
  GEMINI_3_PRO_FAST = 'gemini-3-pro-fast',
  GEMINI_3_PRO_REASONING = 'gemini-3-pro-reasoning'
}

export enum ImageStyle {
  NONE = 'None',
  MODERN_VECTOR = 'Modern Flat Vector (Google Style)',
  PHOTOREALISTIC = 'Photorealistic',
  ANIME = 'Anime & Manga',
  DIGITAL_ART = 'Digital Art',
  COMIC_BOOK = 'Comic Book',
  WATERCOLOR = 'Watercolor',
  THREE_D_RENDER = '3D Render',
  CYBERPUNK = 'Cyberpunk',
  PIXEL_ART = 'Pixel Art',
  SKETCH = 'Sketch / Pencil'
}

export enum VideoStyle {
  NONE = 'None',
  CINEMATIC = 'Cinematic',
  ANIME = 'Anime',
  VINTAGE = 'Vintage Film',
  CYBERPUNK = 'Cyberpunk',
  NATURE = 'Nature Documentary',
  DRONE = 'Drone Footage',
  GLITCH = 'Glitch Art',
  THREE_D = '3D Animation'
}

export enum VideoDuration {
  SHORT = '5 Seconds',
  LONG = '10 Seconds' // Note: Actual duration depends on model capabilities
}

export interface GenerationParams {
  prompt: string;
  negativePrompt?: string; // Not directly supported by all Gemini models but good for UI
  aspectRatio: AspectRatio;
  continuousMode?: boolean; // New: Auto-use result as reference for next turn
  
  // Image specific
  imageModel: ImageModel;
  imageResolution?: ImageResolution;
  imageStyle?: ImageStyle;
  numberOfImages?: number; // New: Number of images to generate (1-4)
  
  // --- Visual Control Center ---
  // 1. Subject / Identity
  subjectReferences?: { data: string; mimeType: string }[];
  subjectType?: 'PERSON' | 'ANIMAL' | 'OBJECT';

  // 2. Composition / Structure
  referenceImage?: string; // Base64 string without data prefix
  referenceImageMimeType?: string;
  isAnnotatedReference?: boolean; // New: Flag to indicate if reference has user annotations (red boxes)
  
  // 3. Style / Vibe
  styleReferences?: { data: string; mimeType: string }[]; // Array of style reference images

  // New: Advanced Creativity
  textToRender?: string; // Specific text to render in the image

  // Video specific
  videoModel: VideoModel;
  videoResolution?: VideoResolution;
  videoStyle?: VideoStyle;
  videoDuration?: VideoDuration;
  seed?: number;
  
  // Video Keyframes (Mutually exclusive with videoStyleReferences)
  videoStartImage?: string;
  videoStartImageMimeType?: string;
  videoEndImage?: string;
  videoEndImageMimeType?: string;

  // Video Style References (Veo HQ only, Mutually exclusive with Keyframes)
  videoStyleReferences?: { data: string; mimeType: string }[];
  
  // New: Video Extension
  inputVideoData?: string; // Base64 of video to extend
  inputVideoMimeType?: string; 
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  image?: string; // Legacy: kept for backward compatibility
  images?: string[]; // New: Supports multiple images
  isThinking?: boolean; // Transient state for UI
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // We save the "Context" (current params) of the project so users can pick up where they left off
  savedParams?: GenerationParams;
  savedMode?: AppMode; 
  chatHistory?: ChatMessage[]; // Used for Image Mode
  videoChatHistory?: ChatMessage[]; // Used for Video Mode
}

export interface AssetItem {
  id: string;
  projectId: string; // Link to project
  type: 'IMAGE' | 'VIDEO';
  url: string;
  thumbnailUrl?: string; // For videos
  prompt: string;
  createdAt: number;
  status: 'PENDING' | 'GENERATING' | 'COMPLETED' | 'FAILED'; // Added GENERATING
  isFavorite?: boolean; // New: Favorite status
  deletedAt?: number; // New: Timestamp when moved to trash
  operationName?: string; // New: Store the Google API Operation ID for long-running tasks
  metadata?: {
    aspectRatio: string;
    model: string;
    style?: string;
    duration?: string;
    resolution?: string;
  };
}

export type TaskStatus = 'QUEUED' | 'GENERATING' | 'COMPLETED' | 'FAILED';

export interface BackgroundTask {
  id: string;
  projectId: string;
  projectName: string;
  type: 'IMAGE' | 'VIDEO';
  status: TaskStatus;
  startTime: number; // When it was added
  executionStartTime?: number; // When it actually started running (left queue)
  prompt: string;
  error?: string;
}

// Window augmentation for Veo Key selection
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
}
