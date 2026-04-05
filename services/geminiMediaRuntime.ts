import { type Content, type Part } from '@google/genai';
import {
  AspectRatio,
  ImageModel,
  SmartAssetRole,
  TextModel,
  ThinkingLevel,
  type AssetItem,
  type ChatMessage,
  type GenerationParams
} from '../types';

const ATTACHED_IMAGE_ID_PATTERN = /^\s*\[Attached Image ID: .+?\]\s*$/;

const stripInlineImagesFromHistoryContents = (contents: Content[]): Content[] => contents.map(content => ({
  ...content,
  parts: (content.parts || []).filter(part => {
    if ((part as any)?.inlineData) return false;
    if (typeof (part as any)?.text === 'string' && ATTACHED_IMAGE_ID_PATTERN.test((part as any).text.trim())) {
      return false;
    }
    return true;
  })
}));

const SINGLE_FRAME_SEQUENCE_GUARDRAIL = 'Render exactly one standalone frame. Do not create a collage, grid, split-screen, diptych, triptych, storyboard, contact sheet, or multiple panels. Show a single continuous camera shot only.';

export const generateImageWithModel = async ({
  ai,
  params,
  projectId,
  onStart,
  signal,
  id,
  history,
  onThoughtImage,
  convertHistoryToNativeFormat,
  buildGoogleSearchTools,
  getRoleInstruction,
  resolveSmartAssetRole,
  now = () => Date.now()
}: {
  ai: any;
  params: GenerationParams;
  projectId: string;
  onStart: () => void;
  signal: AbortSignal;
  id: string;
  history?: ChatMessage[];
  onThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void;
  convertHistoryToNativeFormat: (history: ChatMessage[], modelName: string) => Content[];
  buildGoogleSearchTools: (useImageSearch?: boolean) => any[];
  getRoleInstruction: (role: SmartAssetRole, index: number) => string;
  resolveSmartAssetRole: (asset: any) => SmartAssetRole | undefined;
  now?: () => number;
}): Promise<AssetItem> => {
  onStart();

  console.log('[generateImage] Edit mode check:', {
    hasEditBaseImage: !!params.editBaseImage,
    hasEditMask: !!params.editMask,
    editBaseImageDataLength: params.editBaseImage?.data?.length || 0,
    editMaskDataLength: params.editMask?.data?.length || 0
  });

  console.log('[generateImage] Called with:', {
    model: params.imageModel,
    useGrounding: params.useGrounding,
    aspectRatio: params.aspectRatio
  });

  const rawHistoryContents = history && history.length > 0
    ? convertHistoryToNativeFormat(history, params.imageModel)
    : [];
  const historyContents = (params.smartAssets?.length || 0) > 0
    ? stripInlineImagesFromHistoryContents(rawHistoryContents)
    : rawHistoryContents;

  const historyImagePrefixes = new Set<string>();
  let historyImageCount = 0;
  historyContents.forEach(content => {
    content.parts?.forEach((part: any) => {
      if (part?.inlineData?.data) {
        historyImageCount++;
        historyImagePrefixes.add(String(part.inlineData.data).slice(0, 50));
      }
    });
  });

  const parts: Part[] = [];

  if (params.editBaseImage) {
    console.log('[generateImage] Using EDIT BASE image');
    parts.push({ inlineData: { mimeType: params.editBaseImage.mimeType, data: params.editBaseImage.data } });
    parts.push({ text: getRoleInstruction(SmartAssetRole.EDIT_BASE, 0) });
  }
  if (params.editMask) {
    console.log('[generateImage] Using EDIT MASK image');
    parts.push({ inlineData: { mimeType: params.editMask.mimeType, data: params.editMask.data } });
    parts.push({ text: 'Mask Image (White=Edit, Black=Keep)' });
  }

  const maxImages = (params.imageModel === ImageModel.PRO || params.imageModel === ImageModel.FLASH_3_1) ? 14 : 3;
  const usedSlots = (params.editBaseImage ? 1 : 0) + (params.editMask ? 1 : 0);
  const availableSlots = Math.max(0, maxImages - historyImageCount - usedSlots);
  const smartAssets = (params.smartAssets || []).filter(asset => !historyImagePrefixes.has(asset.data.slice(0, 50)));
  const smartAssetsToUse = availableSlots > 0 ? smartAssets.slice(-availableSlots) : [];

  console.log('[generateImage] Image slots:', {
    maxImages,
    historyImageCount,
    availableSlots,
    smartAssetsCount: (params.smartAssets || []).length,
    filteredCount: smartAssets.length,
    toUseCount: smartAssetsToUse.length
  });

  smartAssetsToUse.forEach((asset, index) => {
    console.log(`[generateImage] Adding reference image ${index + 1}:`, {
      mimeType: asset.mimeType,
      dataLength: asset.data?.length || 0,
      dataPrefix: asset.data?.slice(0, 30) || 'NO DATA'
    });
    parts.push({ inlineData: { mimeType: asset.mimeType, data: asset.data } });
    const role = resolveSmartAssetRole(asset);
    parts.push({ text: role ? getRoleInstruction(role, index) : `[Image ${index + 1}]` });
  });

  console.log('[generateImage] Total parts to send:', parts.length, 'items');

  let mainPrompt = params.prompt;
  if (params.imageStyle && params.imageStyle !== 'None') {
    mainPrompt = `[Style: ${params.imageStyle}] ${mainPrompt}`;
  }
  if (((params.numberOfImages || 1) > 1 || (params.sequenceFramePrompts?.length || 0) > 1) && !mainPrompt.includes(SINGLE_FRAME_SEQUENCE_GUARDRAIL)) {
    mainPrompt += `\n${SINGLE_FRAME_SEQUENCE_GUARDRAIL}`;
  }
  if (params.negativePrompt) mainPrompt += `\nAvoid: ${params.negativePrompt}`;
  console.log('[generateImage] Final main prompt preview:', {
    promptPreview: mainPrompt.slice(0, 600),
    promptLength: mainPrompt.length,
    sequenceFramePromptsCount: params.sequenceFramePrompts?.length || 0,
    numberOfImages: params.numberOfImages || 1
  });
  parts.push({ text: mainPrompt });

  const contents: Content[] = [...historyContents, { role: 'user', parts }];
  const isPro = params.imageModel === ImageModel.PRO;
  const isFlash31 = params.imageModel === ImageModel.FLASH_3_1;
  const messageConfig: any = {
    responseModalities: ['TEXT', 'IMAGE']
  };

  if (params.useGrounding) {
    const currentDate = new Date();
    const dateStr = currentDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    const dateStrEn = currentDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    messageConfig.systemInstruction = `Today is ${dateStr} (${dateStrEn}).
Use this date as temporal context for all searches — determine whether events have occurred, whether products have been released, or whether information is current.
STRICT REQUIREMENT: You MUST use the search results (googleSearch) to ground your generation.
If search results provide images, descriptions, specifications, or factual data about the subject, follow them EXACTLY.
Prioritize verified, up-to-date information and official visuals found in grounding results over your internal training data.
When generating images, strictly replicate the visual details, colors, materials, proportions, and layout found in the grounding sources.`;
  }

  if (params.aspectRatio || ((isPro || isFlash31) && params.imageResolution)) {
    messageConfig.imageConfig = {
      ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
      ...((isPro || isFlash31) && params.imageResolution && { imageSize: params.imageResolution }),
      ...(params.numberOfImages && { numberOfImages: params.numberOfImages })
    };
  }

  if ((isPro || isFlash31) && params.useGrounding) {
    messageConfig.tools = buildGoogleSearchTools(isFlash31);
  }

  if (isFlash31) {
    messageConfig.thinkingConfig = {
      thinkingLevel: params.thinkingLevel || ThinkingLevel.MINIMAL,
      includeThoughts: true
    };
  }

  console.log('[GeminiService] generateContent config:', JSON.stringify(messageConfig, null, 2));

  if (signal.aborted) throw new Error('Cancelled');

  let abortHandler: (() => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled'));
      return;
    }
    abortHandler = () => reject(new Error('Cancelled'));
    signal.addEventListener('abort', abortHandler, { once: true });
  });

  let response: any;
  try {
    response = await Promise.race([
      ai.models.generateContent({
        model: params.imageModel,
        contents,
        config: messageConfig
      }),
      abortPromise
    ]);
  } finally {
    if (abortHandler) signal.removeEventListener('abort', abortHandler);
  }

  if (signal.aborted) throw new Error('Cancelled');

  console.log('[GeminiService] Full Response:', response);
  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
  if (groundingMetadata) {
    console.log('[GeminiService] Grounding Metadata (Search Results):', JSON.stringify(groundingMetadata, null, 2));
  }

  let imageUrl = '';
  const finishReason = String(response.candidates?.[0]?.finishReason || 'UNKNOWN');
  const collectedSignatures: Array<{ partIndex: number; signature: string }> = [];

  if (response.candidates?.[0]?.content?.parts) {
    let imagePartIndex = 0;
    for (let idx = 0; idx < response.candidates[0].content.parts.length; idx++) {
      const part = response.candidates[0].content.parts[idx];

      if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
        const isThought = part.thought === true;
        if (onThoughtImage) {
          onThoughtImage({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
            isFinal: !isThought
          });
        }
        if (!isThought && !imageUrl) {
          imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
        if (part.thoughtSignature) {
          collectedSignatures.push({ partIndex: imagePartIndex, signature: part.thoughtSignature });
        }
        imagePartIndex++;
        continue;
      }

      if (part.thoughtSignature) {
        collectedSignatures.push({ partIndex: -1, signature: part.thoughtSignature });
      }
    }
  }

  if (!imageUrl) {
    const candidate = response.candidates?.[0];
    const safetyRatings = candidate?.safetyRatings;
    const blockReason = response.promptFeedback?.blockReason;
    const blockReasonMessage = response.promptFeedback?.blockReasonMessage;

    console.error('[generateImage] No image generated. Debug info:', {
      finishReason,
      blockReason,
      blockReasonMessage,
      safetyRatings: safetyRatings?.map((r: any) => ({ category: r.category, probability: r.probability, blocked: r.blocked })),
      partsCount: candidate?.content?.parts?.length || 0,
      fullResponse: JSON.stringify(response, null, 2).slice(0, 2000)
    });

    if (finishReason === 'SAFETY' || finishReason === 'BLOCKED' || finishReason === 'BLOCKLIST') {
      const categories = safetyRatings?.filter((r: any) => r.blocked || r.probability === 'HIGH')
        .map((r: any) => r.category).join(', ') || 'unknown';
      throw new Error(`Image blocked by safety filters (${categories}). Please modify your prompt.`);
    } else if (finishReason === 'RECITATION') {
      throw new Error('Image blocked due to copyright/trademark concerns. Try describing original content instead of copyrighted characters.');
    } else if (finishReason === 'MAX_TOKENS') {
      throw new Error('Response truncated. Try a simpler prompt.');
    } else if (blockReason) {
      throw new Error(`Image blocked: ${blockReason}. ${blockReasonMessage || 'Try a different prompt.'}`);
    } else {
      throw new Error(`Image generation failed. Reason: ${finishReason}. The model did not produce an image - try rephrasing your prompt or check console for details.`);
    }
  }

  return {
    id,
    projectId,
    type: 'IMAGE',
    url: imageUrl,
    prompt: params.prompt,
    createdAt: now(),
    status: 'COMPLETED',
    metadata: {
      model: params.imageModel,
      aspectRatio: params.aspectRatio,
      resolution: params.imageResolution,
      usedGrounding: params.useGrounding,
      thoughtSignatures: collectedSignatures.length > 0 ? collectedSignatures : undefined
    }
  };
};

export const generateVideoWithModel = async ({
  ai,
  params,
  onUpdate,
  onStart,
  signal,
  createTrackedBlobUrl,
  getApiKey,
  pollDelayMs = 5000,
  maxPollAttempts = 60,
  fetchImpl = fetch
}: {
  ai: any;
  params: GenerationParams;
  onUpdate: (opName: string) => Promise<void>;
  onStart: () => void;
  signal: AbortSignal;
  createTrackedBlobUrl: (blob: Blob) => string;
  getApiKey: () => string | null | undefined;
  pollDelayMs?: number;
  maxPollAttempts?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ blobUrl: string; videoUri?: string }> => {
  onStart();
  if (params.videoModel.includes('veo') && window.aistudio && !await window.aistudio.hasSelectedApiKey()) {
    await window.aistudio.openSelectKey();
  }

  const config: any = {
    numberOfVideos: 1,
    resolution: params.videoResolution as '720p' | '1080p',
    aspectRatio: params.aspectRatio === AspectRatio.PORTRAIT ? '9:16' : '16:9',
    durationSeconds: params.videoDuration || '4',
    personGeneration: 'allow_all'
  };

  let imageInput = undefined;
  if (params.videoStartImage && params.videoStartImageMimeType) {
    imageInput = { imageBytes: params.videoStartImage, mimeType: params.videoStartImageMimeType };
  }

  let videoPrompt = params.prompt;
  if (params.videoStyle && params.videoStyle !== 'None') {
    videoPrompt = `[Style: ${params.videoStyle}] ${videoPrompt}`;
  }

  if (params.videoStyleReferences && params.videoStyleReferences.length > 0) {
    config.referenceImages = params.videoStyleReferences.map(ref => ({
      image: { imageBytes: ref.data, mimeType: ref.mimeType },
      referenceType: 'ASSET'
    }));
  }

  if (params.videoEndImage && params.videoEndImageMimeType) {
    config.lastFrame = { imageBytes: params.videoEndImage, mimeType: params.videoEndImageMimeType };
  }

  const generateRequest: any = {
    model: params.videoModel,
    prompt: videoPrompt,
    image: imageInput,
    config
  };

  if (params.inputVideoUri) {
    generateRequest.video = { uri: params.inputVideoUri };
    config.resolution = '720p';
    console.log('[Video] Extension mode: using source video URI');
  }

  let operation = await ai.models.generateVideos(generateRequest);
  if (operation.name) {
    await onUpdate(operation.name);
  }

  let pollAttempts = 0;
  while (!operation.done) {
    if (signal.aborted) throw new Error('Cancelled');
    pollAttempts++;
    if (pollAttempts >= maxPollAttempts) {
      throw new Error(`Video generation timed out after ${maxPollAttempts * (pollDelayMs / 1000)} seconds. Please try again.`);
    }
    await new Promise(resolve => setTimeout(resolve, pollDelayMs));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    throw new Error('Video generation completed but no download link was returned. The video may have been blocked by safety filters.');
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API key is required to download the generated video. Please configure your API key in settings.');
  }

  const response = await fetchImpl(`${downloadLink}&key=${apiKey}`);
  if (!response.ok) {
    throw new Error(`Failed to download video: HTTP ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const blobUrl = createTrackedBlobUrl(blob);
  const videoUri = downloadLink.split('&')[0];
  return { blobUrl, videoUri };
};
