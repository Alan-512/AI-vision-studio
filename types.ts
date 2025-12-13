
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

// NEW: Smart Asset Interface
export interface SmartAsset {
  id: string;
  data: string; // Base64
  mimeType: string;
  type: 'IDENTITY' | 'STRUCTURE' | 'STYLE';
  label?: string; // Custom user label text
  selectedTags?: string[]; // Array of selected preset tag keys (e.g. 'tag.person')
  isAnnotated?: boolean; // For Inpainting masks
}

export interface GenerationParams {
  prompt: string;
  negativePrompt?: string; // Not directly supported by all Gemini models but good for UI
  aspectRatio: AspectRatio;
  continuousMode?: boolean; // New: Auto-use result as reference for next turn
  isAutoMode?: boolean; // New: Agent Autonomous Mode
  
  // Image specific
  imageModel: ImageModel;
  imageResolution?: ImageResolution;
  imageStyle?: ImageStyle;
  numberOfImages?: number; // New: Number of images to generate (1-4)
  useGrounding?: boolean; // New: Use Google Search Grounding (Pro model only)
  guidanceScale?: number; // New: CFG Scale (0-10 or higher)
  
  // --- NEW: UNIFIED VISUAL CONTROL ---
  smartAssets?: SmartAsset[];

  // --- LEGACY FIELDS (Kept for compatibility with existing saved projects/Inpainting flow) ---
  subjectReferences?: { data: string; mimeType: string }[];
  subjectType?: 'PERSON' | 'ANIMAL' | 'OBJECT';
  referenceImage?: string; // Base64 string of the ANNOTATED/MASKED image
  referenceImageMimeType?: string;
  originalReferenceImage?: string; // Base64 string of the CLEAN ORIGINAL image
  originalReferenceImageMimeType?: string;
  isAnnotatedReference?: boolean; // New: Flag to indicate if reference has user annotations (red boxes)
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

// --- ARCHITECTURE UPGRADE: JOB MODEL & EVENT STREAM ---

// 1. The Job Model (Separating Execution State from Chat)
export interface AgentJob {
  id: string;
  projectId: string;
  type: 'IMAGE_GENERATION' | 'VIDEO_GENERATION' | 'CONTEXT_UPDATE';
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'requires_action';
  createdAt: number;
  updatedAt: number;
  steps: JobStep[];
  artifacts: JobArtifact[];
  cost?: number; // Token usage or estimated cost
}

export interface JobStep {
  id: string;
  name: string; // e.g., "generate_image", "optimize_prompt"
  status: 'pending' | 'running' | 'success' | 'failed';
  input?: any;
  output?: any;
  error?: string;
  startTime?: number;
  endTime?: number;
}

export interface JobArtifact {
  id: string;
  type: 'image' | 'video' | 'json' | 'text';
  url?: string; // Blob URL or Remote URL
  base64?: string; // Fallback
  mimeType?: string;
  metadata?: any;
}

// 2. Chat Message (Enhanced)
export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  image?: string; // Legacy
  images?: string[]; 
  isThinking?: boolean; 
  
  // Link to the Job System
  relatedJobId?: string; // If this message triggered a job
  toolCalls?: ToolCallRecord[]; // Record of tools called in this turn
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  args: any;
  status: 'pending' | 'success' | 'failed';
  result?: any;
}

// 3. Project Model
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  savedParams?: GenerationParams;
  savedMode?: AppMode; 
  chatHistory?: ChatMessage[]; 
  videoChatHistory?: ChatMessage[];
  
  // Active Jobs (New)
  activeJobs?: AgentJob[];
  
  contextSummary?: string; 
  summaryCursor?: number; 
}

// --- EXISTING TYPES ---

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
  isNew?: boolean; // New: Indicator for newly generated assets
  deletedAt?: number; // New: Timestamp when moved to trash
  operationName?: string; // New: Store the Google API Operation ID for long-running tasks
  
  // Link to Job System
  jobId?: string; // Which job created this asset
  
  metadata?: {
    aspectRatio: string;
    model: string;
    style?: string;
    duration?: string;
    resolution?: string;
    seed?: number; // Added seed
    guidanceScale?: number; // Added CFG
    usedGrounding?: boolean; // New: Metadata to track if grounding was used
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
  
  // Link to Job System
  jobId?: string;
}

// Window augmentation for Veo Key selection
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
}
