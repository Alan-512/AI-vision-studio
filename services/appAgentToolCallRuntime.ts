import type { Dispatch, SetStateAction } from 'react';
import {
  AppMode,
  AspectRatio,
  AssistantMode,
  EditRegion,
  ImageModel,
  ImageResolution,
  ImageStyle,
  ThinkingLevel,
  type AgentAction,
  type AgentJob,
  type AgentToolResult,
  type AssetItem,
  type ChatMessage,
  type GenerationParams,
  type ImageStyle as ImageStyleType,
  type SmartAsset,
  type ToolCallRecord
} from '../types';
import type { SelectedReferenceRecord } from './agentRuntime';
import { buildSequenceFramePrompts } from './toolboxRuntime';
import { normalizeSequenceAwarePrompt } from './sequencePlanningRuntime';

const defaultCreateToolCallKey = (action: AgentAction, rawArgs: unknown) =>
  `${action.toolName}-${JSON.stringify(rawArgs ?? {}).slice(0, 100)}`;

const createToolErrorResult = (toolName: string, error: string): AgentToolResult => ({
  jobId: '',
  toolName,
  status: 'error',
  error
});

type PlaybookDefaults = {
  aspectRatio?: AspectRatio;
  imageStyle?: ImageStyleType;
  imageResolution?: ImageResolution;
  thinkingLevel?: ThinkingLevel;
  negativePrompt?: string;
  referenceMode?: string;
};

type RightPanelMode = 'GALLERY' | 'TRASH' | 'CANVAS';

type ThoughtImage = {
  id: string;
  data: string;
  mimeType: string;
  isFinal: boolean;
  timestamp: number;
};

type ChatEditParamsState = {
  editBaseImage?: SmartAsset;
  editMask?: SmartAsset;
  editRegions?: EditRegion[];
};

type ReferenceRecordSelectorInput = {
  jobs: AgentJob[];
  chatHistory: ChatMessage[];
  requestedIds: string[];
  playbookReferenceMode?: string;
  hasUserUploadedImages: boolean;
};

export const createAppAgentToolCallHandler = ({
  mode,
  processingToolCallKeys,
  createToolCallId = () => crypto.randomUUID(),
  createToolCallKey = defaultCreateToolCallKey,
  upsertLastModelToolCall,
  updateLastModelMessage,
  setChatHistory,
  handleModeSwitch,
  addToast,
  handleGenerate,
  normalizeAssistantMode,
  getPlaybookDefaults,
  loadAgentJobsByProject,
  activeProjectId,
  chatParams,
  chatHistory,
  chatEditParams,
  setRightPanelMode,
  setThoughtImages,
  setChatEditParams,
  setAgentContextAssets,
  extractSearchContextFromProgress,
  selectReferenceRecords,
  latestSearchProgress,
  compressImageForContext,
  resolveToolCallRecordStatus
}: {
  mode: AppMode;
  processingToolCallKeys: Set<string>;
  createToolCallId?: () => string;
  createToolCallKey?: (action: AgentAction, rawArgs: unknown) => string;
  upsertLastModelToolCall: (
    toolCallId: string,
    updater: (record: ToolCallRecord | undefined) => ToolCallRecord
  ) => void;
  updateLastModelMessage: (updater: (message: ChatMessage) => ChatMessage) => void;
  setChatHistory: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  handleModeSwitch: (mode: AppMode) => void;
  addToast: (type: 'success' | 'error' | 'info', title: string, message: string) => void;
  handleGenerate: (params: GenerationParams, options?: Record<string, unknown>) => Promise<AgentToolResult[]>;
  normalizeAssistantMode: (value: unknown) => AssistantMode | undefined;
  getPlaybookDefaults: (assistantMode: AssistantMode | undefined) => PlaybookDefaults;
  loadAgentJobsByProject: (projectId: string) => Promise<AgentJob[]>;
  activeProjectId: string;
  chatParams: Partial<GenerationParams>;
  chatHistory: ChatMessage[];
  chatEditParams: ChatEditParamsState;
  setRightPanelMode: Dispatch<SetStateAction<RightPanelMode>>;
  setThoughtImages: Dispatch<SetStateAction<ThoughtImage[]>>;
  setChatEditParams: Dispatch<SetStateAction<ChatEditParamsState>>;
  setAgentContextAssets: Dispatch<SetStateAction<SmartAsset[]>>;
  extractSearchContextFromProgress: (progress: any) => any;
  selectReferenceRecords: (input: ReferenceRecordSelectorInput) => SelectedReferenceRecord[];
  latestSearchProgress: any;
  compressImageForContext: (blob: Blob) => Promise<string>;
  resolveToolCallRecordStatus: (status: AgentToolResult['status']) => ToolCallRecord['status'];
}) => {
  const upsertChatFeedbackImage = (asset: AssetItem, imageUrl: string) => {
    if (!imageUrl) return;
    const assetSignatures = (asset.metadata as any)?.thoughtSignatures;
    setChatHistory(prev => {
      const next = [...prev];
      const feedbackIndex = next.findIndex(message =>
        message.isSystem &&
        message.relatedJobId === asset.jobId &&
        message.content.startsWith('[SYSTEM_FEEDBACK]: Image generated successfully')
      );
      const feedbackMessage: ChatMessage = {
        role: 'user',
        content: `[SYSTEM_FEEDBACK]: Image generated successfully based on prompt: "${asset.prompt}".\nHere is the visual result (Thumbnail). Use this as context for consistency.`,
        timestamp: Date.now(),
        image: imageUrl,
        isSystem: true,
        relatedJobId: asset.jobId,
        thoughtSignatures: assetSignatures
      };
      if (feedbackIndex >= 0) {
        next[feedbackIndex] = {
          ...next[feedbackIndex],
          ...feedbackMessage
        };
        return next;
      }
      return [...next, feedbackMessage];
    });
  };

  return async (action: AgentAction): Promise<AgentToolResult> => {
    const rawArgs = action.args && typeof action.args === 'object' && 'parameters' in action.args
      ? (action.args as { parameters: any }).parameters
      : action.args;
    const toolCallId = createToolCallId();
    const toolCallKey = createToolCallKey(action, rawArgs);

    if (processingToolCallKeys.has(toolCallKey)) {
      console.warn('[Agent] Duplicate tool call detected, skipping:', toolCallKey.slice(0, 50));
      return {
        jobId: '',
        toolName: action.toolName,
        status: 'success',
        message: 'Duplicate tool call ignored.',
        metadata: { deduplicated: true }
      };
    }

    processingToolCallKeys.add(toolCallKey);

    try {
      if (action.toolName !== 'generate_image') {
        return createToolErrorResult(action.toolName, `Unsupported tool: ${action.toolName}`);
      }

      const toolArgs = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const { prompt, aspectRatio, style, resolution, thinkingLevel, negativePrompt, save_as_reference, numberOfImages, sequence_frame_prompts } = toolArgs as Record<string, any>;
      upsertLastModelToolCall(toolCallId, () => ({
        id: toolCallId,
        toolName: action.toolName,
        args: toolArgs,
        status: 'running',
        startedAt: Date.now()
      }));
      setRightPanelMode('GALLERY');
      if (mode !== AppMode.IMAGE) handleModeSwitch(AppMode.IMAGE);

      const basePrompt = typeof prompt === 'string' ? prompt.trim() : '';
      const normalizedPrompt = normalizeSequenceAwarePrompt({
        prompt: basePrompt,
        rawArgs: toolArgs
      });
      if (!normalizedPrompt) {
        const failedResult = createToolErrorResult(action.toolName, 'Prompt missing for generate_image tool call.');
        upsertLastModelToolCall(toolCallId, existing => ({
          ...(existing || {
            id: toolCallId,
            toolName: action.toolName,
            args: toolArgs
          }),
          status: 'failed',
          completedAt: Date.now(),
          result: failedResult
        }));
        addToast('error', 'Prompt Missing', '对话生成未收到有效提示词，请重试或换句话描述。');
        return failedResult;
      }

      const chatDefaults = {
        aspectRatio: AspectRatio.LANDSCAPE,
        imageStyle: ImageStyle.NONE,
        imageResolution: ImageResolution.RES_1K,
        thinkingLevel: ThinkingLevel.MINIMAL,
        negativePrompt: ''
      };
      const assistantMode = normalizeAssistantMode((toolArgs as any).assistant_mode);
      const isPlaybookOverridden = (toolArgs as any).override_playbook === true;
      const playbookDefaults = isPlaybookOverridden ? {} : getPlaybookDefaults(assistantMode);
      const hasUserUploadedImages = chatHistory.some(m => m.role === 'user' && (m.image || (m.images && m.images.length > 0)));

      let effectiveModel: ImageModel;
      const aiModel = (toolArgs as any).model;
      if (aiModel && Object.values(ImageModel).includes(aiModel as ImageModel)) {
        effectiveModel = aiModel as ImageModel;
      } else {
        effectiveModel = ImageModel.FLASH_3_1;
      }
      const effectiveGrounding = false;

      setThoughtImages([]);
      const resolvedAspectRatio = Object.values(AspectRatio).includes(aspectRatio as AspectRatio)
        ? (aspectRatio as AspectRatio)
        : (playbookDefaults.aspectRatio ?? chatDefaults.aspectRatio);
      const resolvedStyle = Object.values(ImageStyle).includes(style as ImageStyle)
        ? (style as ImageStyle)
        : (playbookDefaults.imageStyle ?? chatDefaults.imageStyle);
      const resolvedResolution = Object.values(ImageResolution).includes(resolution as ImageResolution)
        ? (resolution as ImageResolution)
        : (playbookDefaults.imageResolution ?? (effectiveModel === ImageModel.PRO ? ImageResolution.RES_2K : chatDefaults.imageResolution));
      const resolvedThinkingLevel = typeof thinkingLevel === 'string'
        ? (thinkingLevel.toLowerCase() as ThinkingLevel)
        : (playbookDefaults.thinkingLevel ?? (effectiveModel === ImageModel.FLASH_3_1 ? chatDefaults.thinkingLevel : undefined));
      const resolvedNegativePrompt = typeof negativePrompt === 'string'
        ? negativePrompt
        : (playbookDefaults.negativePrompt ?? chatDefaults.negativePrompt);
      const parsedNumberOfImages = Number(numberOfImages);
      const resolvedNumberOfImages = Number.isFinite(parsedNumberOfImages) ? parsedNumberOfImages : 1;

      const explicitSequenceFramePrompts = Array.isArray(sequence_frame_prompts)
        ? sequence_frame_prompts.filter((value): value is string => typeof value === 'string')
        : undefined;
      const normalizedSequenceFramePrompts = explicitSequenceFramePrompts
        ? buildSequenceFramePrompts({
            basePrompt: normalizedPrompt,
            count: Number.isFinite(parsedNumberOfImages) ? resolvedNumberOfImages : explicitSequenceFramePrompts.length,
            framePrompts: explicitSequenceFramePrompts
          })
        : undefined;

      const executionParams: Partial<GenerationParams> = {
        prompt: normalizedPrompt,
        aspectRatio: resolvedAspectRatio,
        imageModel: effectiveModel,
        imageStyle: resolvedStyle,
        imageResolution: resolvedResolution,
        thinkingLevel: resolvedThinkingLevel as ThinkingLevel,
        negativePrompt: resolvedNegativePrompt,
        numberOfImages: normalizedSequenceFramePrompts?.length || resolvedNumberOfImages,
        sequenceFramePrompts: normalizedSequenceFramePrompts,
        useGrounding: effectiveGrounding,
        videoModel: chatParams.videoModel,
        smartAssets: (() => {
          const latestUserMsg = [...chatHistory].reverse().find(m => m.role === 'user' && !m.isSystem && (m.images?.length || m.image));
          const images: SmartAsset[] = [];
          if (latestUserMsg?.images) {
            latestUserMsg.images.forEach((img, idx) => {
              const match = img.match(/^data:(.+);base64,(.+)$/);
              if (match) images.push({ id: `latest-${idx}`, mimeType: match[1], data: match[2] });
            });
          } else if (latestUserMsg?.image) {
            const match = latestUserMsg.image.match(/^data:(.+);base64,(.+)$/);
            if (match) images.push({ id: 'latest-0', mimeType: match[1], data: match[2] });
          }
          return images;
        })(),
        editBaseImage: chatEditParams.editBaseImage,
        editMask: chatEditParams.editMask,
        editRegions: chatEditParams.editRegions,
        continuousMode: false
      };

      const playbookReferenceMode = playbookDefaults.referenceMode;
      const requestedIds = Array.isArray((toolArgs as any).reference_image_ids) ? (toolArgs as any).reference_image_ids : [];

      console.log('[AgentToolCall] generate_image normalized input:', {
        promptPreview: normalizedPrompt.slice(0, 240),
        numberOfImages: resolvedNumberOfImages,
        explicitSequenceFramePrompts: explicitSequenceFramePrompts || [],
        normalizedSequenceFramePrompts: normalizedSequenceFramePrompts || [],
        smartAssetsCount: executionParams.smartAssets?.length || 0,
        requestedReferenceIds: requestedIds
      });

      const projectAgentJobs = await loadAgentJobsByProject(activeProjectId);
      const selectedReferences = selectReferenceRecords({
        jobs: projectAgentJobs,
        chatHistory,
        requestedIds,
        playbookReferenceMode,
        hasUserUploadedImages
      });

      selectedReferences.forEach((ref: any) => {
        const exists = executionParams.smartAssets?.some(a => a.data.slice(0, 50) === ref.asset.data.slice(0, 50));
        if (!exists) {
          executionParams.smartAssets?.push(ref.asset);
        }
      });

      console.log('[AgentToolCall] generate_image resolved references:', {
        selectedReferenceCount: selectedReferences.length,
        finalSmartAssetsCount: executionParams.smartAssets?.length || 0,
        playbookReferenceMode,
        hasUserUploadedImages
      });

      let onSuccessCallback: ((asset: AssetItem) => Promise<void>) | undefined;
      if (save_as_reference && save_as_reference !== 'NONE') {
        onSuccessCallback = async (asset: AssetItem) => {
          try {
            const response = await fetch(asset.url);
            const blob = await response.blob();
            const compressedBase64 = await compressImageForContext(blob);
            const matches = compressedBase64.match(/^data:(.+);base64,(.+)$/);
            if (matches) {
              const newSmartAsset: SmartAsset = {
                id: crypto.randomUUID(),
                data: matches[2],
                mimeType: matches[1]
              };
              setAgentContextAssets(prev => [...prev, newSmartAsset]);
            }
          } catch (e) {
            console.error('Failed to capture asset context', e);
          }
        };
      }

      const onPreview = (asset: AssetItem) => {
        if (asset.jobId) {
          updateLastModelMessage(message => ({
            ...message,
            relatedJobId: asset.jobId
          }));
        }
        upsertChatFeedbackImage(asset, asset.url);
      };

      const onComplete = async (asset: AssetItem) => {
        if (onSuccessCallback) await onSuccessCallback(asset);
        let contextImageBase64 = '';
        try {
          const response = await fetch(asset.url);
          const blob = await response.blob();
          contextImageBase64 = await compressImageForContext(blob);
        } catch (e) {
          console.warn('Failed to fetch image data for chat context', e);
        }
        if (contextImageBase64) {
          upsertChatFeedbackImage(asset, contextImageBase64);
        }
      };

      const toolResults = await handleGenerate(executionParams as GenerationParams, {
        generationSurface: 'assistant',
        modeOverride: AppMode.IMAGE,
        onPreview,
        onSuccess: onComplete,
        historyOverride: chatHistory,
        useParamsAsBase: false,
        jobSource: 'chat',
        toolCall: action,
        selectedReferenceRecords: selectedReferences,
        searchContextOverride: extractSearchContextFromProgress(latestSearchProgress),
        resumeJobId: typeof (toolArgs as any).resume_job_id === 'string' && (toolArgs as any).resume_job_id.trim() ? (toolArgs as any).resume_job_id : undefined,
        resumeActionType: typeof (toolArgs as any).requires_action_type === 'string' ? (toolArgs as any).requires_action_type : undefined
      });
      const primaryResult = toolResults[0] || createToolErrorResult(action.toolName, 'Tool execution produced no result.');
      upsertLastModelToolCall(toolCallId, existing => ({
        ...(existing || {
          id: toolCallId,
          toolName: action.toolName,
          args: toolArgs
        }),
        status: resolveToolCallRecordStatus(primaryResult.status),
        jobId: primaryResult.jobId,
        stepId: primaryResult.stepId,
        completedAt: Date.now(),
        result: primaryResult
      }));
      if (primaryResult.jobId) {
        updateLastModelMessage(message => ({
          ...message,
          relatedJobId: primaryResult.jobId
        }));
      }
      setChatEditParams({});
      return primaryResult;
    } catch (error: any) {
      if (typeof error?.message === 'string' && error.message.includes('Sequence generation')) {
        addToast('error', 'Sequence Generation Error', error.message);
      }
      const failedResult = createToolErrorResult(action.toolName, error?.message || String(error));
      upsertLastModelToolCall(toolCallId, existing => ({
        ...(existing || {
          id: toolCallId,
          toolName: action.toolName,
          args: rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
        }),
        status: 'failed',
        completedAt: Date.now(),
        result: failedResult
      }));
      return failedResult;
    } finally {
      processingToolCallKeys.delete(toolCallKey);
    }
  };
};
