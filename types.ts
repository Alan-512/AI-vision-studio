
export enum AppMode {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  GALLERY = 'GALLERY'
}



export const APP_LIMITS = {
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024, // 20MB
  MAX_IMAGE_COUNT: 10,
  MAX_VIDEO_STYLE_REFS: 3
};

export enum AspectRatio {
  SQUARE = '1:1',
  LANDSCAPE = '16:9',
  PORTRAIT = '9:16',
  FOUR_THIRDS = '4:3',
  THREE_FOURTHS = '3:4',
  // Additional ratios supported by Gemini API
  TWO_THIRDS = '2:3',      // Vertical photo ratio
  THREE_TWOS = '3:2',      // 35mm film ratio
  FOUR_FIFTHS = '4:5',     // Instagram portrait
  FIVE_FOURTHS = '5:4',    // Large format camera
  ULTRAWIDE = '21:9'       // Cinematic ultrawide
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

// ChatModel is now merged into TextModel - use TextModel.FLASH and TextModel.PRO

// Text models for general tasks (prompts, descriptions, etc.)
export enum TextModel {
  FLASH = 'gemini-3-flash-preview',      // Fast, general purpose
  PRO = 'gemini-3-pro-preview'           // More capable, slower
}

export enum AssistantMode {
  CREATE_NEW = 'CREATE_NEW',
  STYLE_TRANSFER = 'STYLE_TRANSFER',
  EDIT_LAST = 'EDIT_LAST',
  COMBINE_REFS = 'COMBINE_REFS',
  PRODUCT_SHOT = 'PRODUCT_SHOT',
  POSTER = 'POSTER'
}

export enum SmartAssetRole {
  STYLE = 'STYLE',
  SUBJECT = 'SUBJECT',
  COMPOSITION = 'COMPOSITION',
  EDIT_BASE = 'EDIT_BASE'
}

export enum ImageStyle {
  NONE = 'None',
  PHOTOREALISTIC = 'photorealistic photograph style',
  MINIMALIST = 'minimalist clean composition with ample white space',
  LIFESTYLE = 'lifestyle photography in natural setting',
  THREE_D_RENDER = '3D rendered product visualization style',
  ANIME = 'anime illustration style',
  DIGITAL_ART = 'digital art style',
  COMIC_BOOK = 'comic book illustration style',
  WATERCOLOR = 'watercolor painting style',
  CYBERPUNK = 'cyberpunk aesthetic with neon lights',
  PIXEL_ART = 'pixel art retro game style',
  SKETCH = 'pencil sketch drawing style',
  RETRO = 'retro vintage aesthetic style',
  NEON_GLOW = 'neon glow retrofuturistic style',
  HAND_DRAWN = 'hand-drawn organic illustration style',
  METALLIC = 'metallic chrome finish style',
  MAXIMALIST = 'maximalist vibrant colorful illustration'
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
  SHORT = '4',
  MEDIUM = '6',
  LONG = '8'
}

// SearchPolicy: Controls how search is performed when user enables search
export enum SearchPolicy {
  LLM_ONLY = 'llm_only',      // Default: LLM searches, passes structured facts to prompt
  IMAGE_ONLY = 'image_only',  // Image model searches directly (Pro only)
  BOTH = 'both'               // Both search (rarely needed, avoid cost duplication)
}

// SearchProgress: Structured search info for UI display (2025 best practices)
export interface SearchProgress {
  status: 'searching' | 'complete';
  title?: string;                    // e.g., "搜索阿凡达3和潘多拉星球的相关信息"
  queries?: string[];                // e.g., ["Avatar 3 release date", "Pandora planet visual style"]
  results?: Array<{                  // Extracted key findings
    label: string;
    value: string;
  }>;
  sources?: Array<{                  // Web sources from groundingChunks
    title: string;
    url: string;
  }>;
}

// Reference Image (simplified - user describes usage in prompt)
export interface SmartAsset {
  id: string;
  data: string; // Base64
  mimeType: string;
  role?: SmartAssetRole;
  type?: string; // Legacy: older assets may store STRUCTURE/STYLE/SUBJECT
}

export interface EditRegion {
  id: string;
  color?: string; // UI hint
  instruction?: string;
  maskData: string; // Base64
  maskMimeType: string;
}

export interface GenerationParams {
  prompt: string;
  // --- New: Isolated Prompts Storage ---
  savedImagePrompt?: string;
  savedVideoPrompt?: string;

  // --- NEW: Prompt Builder Selected Tags (Separated by mode) ---
  selectedImageTags?: string[]; // Selected tag keys for Image mode
  selectedVideoTags?: string[]; // Selected tag keys for Video mode

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
  searchPolicy?: SearchPolicy; // New: Controls search behavior (llm_only, image_only, both)

  // --- NEW: UNIFIED VISUAL CONTROL ---
  smartAssets?: SmartAsset[];

  // --- EDITING (Base + Mask + Edit Spec) ---
  editBaseImage?: SmartAsset; // Clean base image
  editMask?: SmartAsset; // Merged mask (white=editable, black=locked)
  editRegions?: EditRegion[]; // Per-region masks + instructions
  editPreviewImage?: string; // Base64 preview for UI display
  editPreviewMimeType?: string; // Mime type for preview

  // --- LEGACY FIELDS (Kept for compatibility with existing saved projects/Inpainting flow) ---
  subjectReferences?: { data: string; mimeType: string }[];
  subjectType?: 'PERSON' | 'ANIMAL' | 'OBJECT';

  referenceImage?: string; // Base64 string of the ANNOTATED/MASKED image (Composite)
  referenceImageMimeType?: string;

  originalReferenceImage?: string; // Base64 string of the CLEAN ORIGINAL image
  originalReferenceImageMimeType?: string;

  maskImage?: string; // NEW: Base64 string of the B&W MASK
  maskImageMimeType?: string;

  isAnnotatedReference?: boolean; // New: Flag to indicate if reference has user annotations (red boxes)
  styleReferences?: { data: string; mimeType: string }[]; // Array of style reference images

  // Video specific
  videoModel: VideoModel;
  videoResolution?: VideoResolution;
  videoStyle?: VideoStyle;
  videoDuration?: VideoDuration;

  // Video Keyframes (Mutually exclusive with videoStyleReferences)
  videoStartImage?: string;
  videoStartImageMimeType?: string;
  videoEndImage?: string;
  videoEndImageMimeType?: string;

  // Video Style References (Veo HQ only, Mutually exclusive with Keyframes)
  videoStyleReferences?: { data: string; mimeType: string }[];

  // New: Video Extension (Veo API requires URI, not base64)
  inputVideoUri?: string; // Google File URI of video to extend
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
  thinkingContent?: string; // Native Gemini thinking summaries (persists after completion)
  isSystem?: boolean; // New: Indicates a system-injected message (e.g. tool output)

  // Gemini 3 Pro Thinking mode: Store thought signatures for multi-turn stability
  // These must be passed back to the model in the next turn
  thoughtSignatures?: Array<{
    partIndex: number;  // Which part this signature belongs to
    signature: string;  // The actual signature string
  }>;

  // Search progress data (persisted with message for history display)
  searchProgress?: SearchProgress;

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
  deletedAt?: number; // Timestamp when moved to trash
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
  operationName?: string; // Store the Google API Operation ID for long-running tasks
  videoUri?: string; // New: Google File URI for video extension support

  // Link to Job System
  jobId?: string; // Which job created this asset

  metadata?: {
    aspectRatio: string;
    model: string;
    style?: string;
    duration?: string;
    resolution?: string;
    usedGrounding?: boolean; // New: Metadata to track if grounding was used
    error?: string; // Error message
    maskUrl?: string; // New: Link to mask image if this was an edit
    thoughtSignatures?: Array<{ partIndex: number; signature: string }>; // Pro model multi-turn editing
  };
  blob?: Blob; // For IndexedDB storage
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

export interface AgentAction {
  toolName: string;
  args: any;
  thought?: string;
}

// Window augmentation for Veo Key selection
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
}
