import { FunctionDeclaration, Type } from '@google/genai';
import { AspectRatio, AssistantMode, ImageModel, ImageResolution, ThinkingLevel } from '../types';

export const generateImageTool: FunctionDeclaration = {
  name: 'generate_image',
  parameters: {
    type: Type.OBJECT,
    description: 'Trigger the image generation engine with specific parameters.',
    properties: {
      prompt: {
        type: Type.STRING,
        description: `The COMPLETE visual prompt synthesized from the ENTIRE conversation.

=== REQUIRED (always include) ===
1. CONVERSATION SYNTHESIS:
   - The user's ORIGINAL intent and core subject
   - ALL refinements and agreements from the discussion
   - The FINAL consensus - integrate the FULL conversation, not just latest message

2. NARRATIVE STYLE & STRUCTURE:
   - Write flowing sentences describing the scene, NOT keyword lists.
   - Use structured templates based on intent:
     * Stylized: "A [Style] illustration of [Subject], featuring [Characteristics]..."
     * Photorealistic: "A [Shot Type] of [Subject] in [Environment] with [Lighting]..."
     * Product: "A studio-lit photograph of [Product] on [Surface]..."

3. SPECIFICITY:
   - Replace vague terms with hyper-specific details.
   - ❌ "fantasy armor" → ✅ "Ornate elven plate armor with silver leaf etchings"

4. SEMANTIC NEGATIVE:
   - Describe the *absence* of elements positively in the main prompt (e.g., "an empty, deserted street" instead of just "no cars").

=== CONTINUOUS / MULTIPLE IMAGE SEQUENCES ===
If the user requests a sequence, storyboard, or set of distinct images (e.g., "generate 4 e-commerce detail shots"):
- You MUST emit MULTIPLE, SEPARATE generate_image function calls (one for each distinct image).
- DO NOT combine different scenes into one prompt.
- For subject consistency across the sequence, you MUST set reference_mode to "ALL_USER_UPLOADED" or "USER_UPLOADED_ONLY" in EVERY distinct function call if reference images are available.
- For separate multi-image frame sequences, first decide each frame's position, movement beat, and screen focus, then write the prompt for THAT frame only.
- If sequence_intent is "separate_frames", the prompt must describe only one frame's exact camera moment, not a storyboard or merged progression.
- In separate frame mode, align the natural-language prompt with frame_index, frame_total, screen_focus, change_objective, and stable_constraints.

=== OPTIONAL (add only when relevant to the scene) ===
   If the image involves these aspects, include them. Otherwise, omit:
   - Shot type: wide-angle, macro, telephoto, low-angle
   - Lighting: softbox, golden hour, rim light, volumetric
   - Camera: bokeh, depth of field, shutter speed (for photorealism)
   - Mood: serene, dramatic, high-contrast
   - Textures: skin texture, fabric weave, metal sheen
   - Art style: "oil painting", "pencil sketch", "3D render"`
      },
      aspectRatio: { type: Type.STRING, description: 'Aspect ratio. Options: "1:1" (square), "16:9" (landscape), "9:16" (portrait), "4:3", "3:4", "21:9" (ultrawide). Default: "16:9"', enum: Object.values(AspectRatio) },
      model: { type: Type.STRING, description: 'Image model. Use "gemini-3.1-flash-image-preview" (nano banana 2) or "gemini-3-pro-image-preview" (pro/high quality).', enum: Object.values(ImageModel) },
      resolution: { type: Type.STRING, description: 'Output resolution. Options: "1K" (default), "2K" (Pro only), "4K" (Pro only).', enum: Object.values(ImageResolution) },
      useGrounding: { type: Type.BOOLEAN, description: 'Use Google Search for factual accuracy (Pro model only). Default: false.' },
      negativePrompt: { type: Type.STRING, description: 'What to EXCLUDE from the image. Use semantic descriptions: "blurry, low quality, distorted faces, anime style" (when user wants realism).' },
      numberOfImages: { type: Type.NUMBER, description: 'How many variations to generate (1-4). Default: 1. ONLY use > 1 when you want exact variations of the SAME prompt. For a sequence of distinct images, set to 1 and emit multiple separate function calls.' },
      assistant_mode: {
        type: Type.STRING,
        description: `Playbook mode for automatic parameter defaults:
    - CREATE_NEW: Create a new image from scratch
        - STYLE_TRANSFER: Use user - uploaded images for style guidance
            - EDIT_LAST: Modify the last AI - generated image
                - COMBINE_REFS: Combine multiple user - uploaded references
                    - PRODUCT_SHOT: Clean product photography
                        - POSTER: Poster or key visual layout`,
        enum: Object.values(AssistantMode)
      },
      override_playbook: {
        type: Type.BOOLEAN,
        description: 'Set true to bypass playbook defaults when needed for unusual or mixed intents.'
      },
      reference_image_ids: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: `Explicit IDs of images to use as reference.
- Look at the [Attached Image ID: <id>] markers in the conversation history.
- To use an image for style/subject, put its <id> here.
- For pure text-to-image (no reference needed), leave empty.
- When generating a sequence of consistent images, pass the SAME user uploaded image ID to every call.`
      },
      sequence_intent: {
        type: Type.STRING,
        description: 'Optional sequence mode. Use "separate_frames" only when this call is one frame in a multi-image sequence. Use "multi_panel_single_image" only when the user explicitly wants one image with multiple panels.',
        enum: ['separate_frames', 'multi_panel_single_image']
      },
      frame_index: {
        type: Type.NUMBER,
        description: 'Optional zero-based frame index when sequence_intent is "separate_frames".'
      },
      frame_total: {
        type: Type.NUMBER,
        description: 'Optional total number of frames when sequence_intent is "separate_frames".'
      },
      screen_focus: {
        type: Type.STRING,
        description: 'Optional frame-level focus target for the weather board or scene area, such as "left-side forecast area" or "right-side forecast area".'
      },
      change_objective: {
        type: Type.STRING,
        description: 'Optional frame-level change objective describing what should change in this frame relative to neighboring frames, for example host movement, gesture beat, or body orientation.'
      },
      stable_constraints: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Optional constraints that must remain stable across the sequence, such as same host identity, same camera angle, or same studio layout.'
      },
      thinkingLevel: { type: Type.STRING, description: 'Thinking depth for Gemini 3.1 Flash Image. Options: "minimal" (speed), "high" (quality). Default: "minimal".', enum: Object.values(ThinkingLevel) }
    },
    required: [
      'prompt',
      'model',
      'aspectRatio',
      'resolution',
      'useGrounding',
      'numberOfImages',
      'negativePrompt',
      'assistant_mode',
      'thinkingLevel'
    ]
  }
};

export const updateMemoryTool: FunctionDeclaration = {
  name: 'update_memory',
  description: 'Update the user\'s long-term memory (e.g. Creative Profile, Visual Preferences, Generation Defaults) based on explicit user requests or strong inferred preferences from the conversation. When the user\'s current request CONTRADICTS a stored preference, use this to OVERRIDE the old value.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      scope: { type: Type.STRING, description: 'Scope of the memory.', enum: ['global', 'project'] },
      section: { type: Type.STRING, description: 'Section to update (e.g. "Visual Preferences", "Generation Defaults", "Guardrails").' },
      key: { type: Type.STRING, description: 'The preference key to update (e.g. "preferred_style", "color_palette"). If adding to Guardrails, leave empty.' },
      value: { type: Type.STRING, description: 'The value to save for this preference.' }
    },
    required: ['scope', 'section', 'value']
  }
};

export const memorySearchTool: FunctionDeclaration = {
  name: 'memory_search',
  description: 'Search user memory for relevant preferences, habits, and past decisions. Use natural language query (e.g. "what is my preferred aspect ratio?").',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'Natural language search query.' },
      scope: { type: Type.STRING, description: 'Search scope.', enum: ['global', 'project', 'both'] }
    },
    required: ['query']
  }
};
