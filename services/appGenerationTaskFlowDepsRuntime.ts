import type {
  AgentAction,
  AgentJob,
  AppMode,
  AssistantMode,
  AssetItem,
  ChatMessage,
  ConsistencyProfile,
  GenerationParams
} from '../types';
import type { SelectedReferenceRecord } from './agentRuntime';
import type { ImageCriticContextInput } from './imageCriticService';
import { createGenerationTaskFlowDeps } from './generationTaskFlowDepsRuntime';

type GenerationTaskFlowBuilderInput = {
  currentMode: AppMode;
  activeParams: GenerationParams;
  normalizeGenerationParamsForExecution: (
    params: GenerationParams,
    mode: AppMode,
    translateTag: (tagKey: string) => string
  ) => GenerationParams;
  translateTag: (tagKey: string) => string;
  executeGenerationAttempt: (input: any) => Promise<any>;
  executePrimaryReview: (input: any) => Promise<any>;
  executeAutoRevisionFlow: (input: any) => Promise<any>;
  resolvePrimaryReview: (input: any) => Promise<any>;
  resolveAutoRevision: (input: any) => Promise<any>;
  resolveGenerationFailure: (input: any) => Promise<any>;
  generateImageImpl: (
    params: GenerationParams,
    projectId: string,
    onStartCb: () => void,
    signal: AbortSignal,
    taskIdArg: string,
    historyArg?: ChatMessage[],
    onThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void
  ) => Promise<AssetItem>;
  generateVideoImpl: (
    params: GenerationParams,
    onUpdate: (opName: string) => Promise<void>,
    onStartCb: () => void,
    signal: AbortSignal
  ) => Promise<{ blobUrl: string; videoUri?: string }>;
  normalizeAssistantMode: (value: unknown) => AssistantMode | undefined;
  buildImageCriticContext: (input: {
    assistantMode?: AssistantMode;
    negativePrompt?: string;
    selectedReferences: SelectedReferenceRecord[];
    consistencyProfile?: ConsistencyProfile;
    searchContext?: AgentJob['searchContext'];
  }) => ImageCriticContextInput;
  reviewGeneratedAsset: (
    asset: AssetItem,
    reviewPrompt: string,
    criticContext?: ImageCriticContextInput
  ) => Promise<any>;
  buildDefaultRefinePromptRequiresAction: (input: any) => any;
  toolCall?: AgentAction;
  historyOverride?: ChatMessage[];
  chatHistory: ChatMessage[];
  userKey: string;
  runMemoryExtractionTask: (projectId: string, history: ChatMessage[], userKey: string) => Promise<unknown>;
  addToast: (type: 'success' | 'error' | 'info', title: string, message: string) => void;
  handleUseAsReference: (asset: AssetItem, navigateToStudio?: boolean) => void;
  playSuccessSound: () => void;
  playErrorSound: () => void;
  setVideoCooldownEndTime: (value: number) => void;
  getFriendlyError: (err: string) => string;
  language: string;
};

export const createAppGenerationTaskFlowDepsBuilder = ({
  currentMode,
  normalizeGenerationParamsForExecution,
  translateTag,
  executeGenerationAttempt,
  executePrimaryReview,
  executeAutoRevisionFlow,
  resolvePrimaryReview,
  resolveAutoRevision,
  resolveGenerationFailure,
  generateImageImpl,
  generateVideoImpl,
  normalizeAssistantMode,
  buildImageCriticContext,
  reviewGeneratedAsset,
  buildDefaultRefinePromptRequiresAction,
  toolCall,
  historyOverride,
  chatHistory,
  userKey,
  runMemoryExtractionTask,
  addToast,
  handleUseAsReference,
  playSuccessSound,
  playErrorSound,
  setVideoCooldownEndTime,
  getFriendlyError,
  language
}: GenerationTaskFlowBuilderInput) => (runtimeInput: any) => {
  const {
    taskRuntime,
    getAgentJob,
    stepId,
    taskId,
    jobId,
    currentProjectId,
    activeParams,
    initialPendingAsset,
    signal,
    selectedReferenceRecords,
    historyForGeneration,
    latestVisibleAssetRef,
    taskMarkedVisibleCompleteRef,
    playVisibleSuccess
  } = runtimeInput;

  return createGenerationTaskFlowDeps({
    taskRuntime,
    taskContext: {
      getAgentJob,
      stepId,
      taskId,
      jobId,
      currentProjectId,
      activeParams,
      initialPendingAsset,
      signal,
      selectedReferenceRecords,
      historyForGeneration
    },
    generationDeps: {
      normalizeGenerationParams: () => normalizeGenerationParamsForExecution(
        { ...activeParams },
        currentMode,
        translateTag
      ),
      executeGenerationAttempt: ({ genParams, historyForGeneration, taskRuntime, taskContext }: any) => executeGenerationAttempt({
        mode: currentMode,
        agentJob: taskContext.getAgentJob(),
        stepId: taskContext.stepId,
        taskId: taskContext.taskId,
        jobId: taskContext.jobId,
        currentProjectId: taskContext.currentProjectId,
        genParams,
        initialPendingAsset: taskContext.initialPendingAsset,
        signal: taskContext.signal,
        taskRuntime: {
          stageRunningJob: (nestedInput: any) => taskRuntime.stageRunningJob(nestedInput),
          completeVisibleImage: (nestedInput: any) => taskRuntime.completeVisibleImage(nestedInput),
          updateOperation: (nestedInput: any) => taskRuntime.updateOperation(nestedInput),
          completeVideo: (nestedInput: any) => taskRuntime.completeVideo(nestedInput)
        },
        generateImageImpl,
        generateVideoImpl,
        historyForGeneration
      }),
      afterVisibleImage: async ({ asset, taskRuntime, taskContext }: any) => {
        latestVisibleAssetRef.current = asset;
        if (taskContext.signal.aborted) throw new Error('Cancelled');
        playVisibleSuccess();
        if (!taskMarkedVisibleCompleteRef.current) {
          taskMarkedVisibleCompleteRef.current = true;
          await taskRuntime.markTaskVisibleComplete(taskContext.getAgentJob());
        }
      },
      executePrimaryReview: ({ asset, genParams, toolResult, taskRuntime, taskContext }: any) => executePrimaryReview({
        job: taskContext.getAgentJob(),
        asset,
        generationStepId: taskContext.stepId,
        toolResult,
        prompt: genParams.prompt,
        genParams,
        selectedReferences: taskContext.selectedReferenceRecords,
        assistantMode: normalizeAssistantMode((genParams as any).assistant_mode),
        taskRuntime: {
          startReview: (job: AgentJob, shouldSyncTaskView: boolean) => taskRuntime.startReview(job, shouldSyncTaskView)
        },
        buildCriticContext: ({ assistantMode, negativePrompt, selectedReferences, consistencyProfile, searchContext }: any) => buildImageCriticContext({
          assistantMode: normalizeAssistantMode(assistantMode),
          negativePrompt,
          selectedReferences,
          consistencyProfile,
          searchContext
        }),
        reviewAsset: (
          reviewAssetTarget: AssetItem,
          reviewPrompt: string,
          criticContext?: ImageCriticContextInput
        ) => reviewGeneratedAsset(reviewAssetTarget, reviewPrompt, criticContext)
      }),
      executeAutoRevisionFlow: ({ review, genParams, toolResult, generatedArtifact, reviewArtifact, finalizedReviewStep, selectedReferenceRecords, taskRuntime, taskContext }: any) => executeAutoRevisionFlow({
        job: taskContext.getAgentJob(),
        review,
        currentMode,
        originalPrompt: genParams.prompt,
        genParams,
        toolCall,
        finalizedReviewStep,
        reviewArtifact,
        currentProjectId: taskContext.currentProjectId,
        signal: taskContext.signal,
        taskId: taskContext.taskId,
        jobId: taskContext.jobId,
        toolResult,
        selectedReferences: selectedReferenceRecords,
        historyForGeneration: taskContext.historyForGeneration,
        continuousMode: taskContext.activeParams.continuousMode,
        taskRuntime: {
          startAutoRevision: (jobs: AgentJob[]) => taskRuntime.startAutoRevision(jobs)
        },
        generatedArtifact,
        deps: {
          executeAttempt: (nestedInput: any) => executeGenerationAttempt({
            ...nestedInput,
            taskRuntime: {
              publishAssetAndPersistJob: (deepInput: any) => taskRuntime.publishAssetAndPersistJob(deepInput)
            },
            generateImageImpl
          }),
          executeReview: (nestedInput: any) => executePrimaryReview({
            ...nestedInput,
            taskRuntime: {
              buildCriticContext: ({ assistantMode, negativePrompt, selectedReferences, consistencyProfile, searchContext }: any) => buildImageCriticContext({
                assistantMode: normalizeAssistantMode(assistantMode),
                negativePrompt,
                selectedReferences,
                consistencyProfile,
                searchContext
              }),
              reviewAsset: (
                reviewAssetTarget: AssetItem,
                reviewPrompt: string,
                criticContext?: ImageCriticContextInput
              ) => reviewGeneratedAsset(reviewAssetTarget, reviewPrompt, criticContext),
              buildDefaultRequiresAction: ({ prompt, latestAssetId, review }: any) => buildDefaultRefinePromptRequiresAction({
                prompt,
                latestAssetId,
                review
              })
            }
          }),
          resolveAutoRevision: (nestedInput: any) => resolveAutoRevision({
            ...nestedInput,
            deps: {
              resolveAutoRevision: (job: AgentJob, shouldSyncTaskView: boolean) => taskRuntime.resolveAutoRevision(job, shouldSyncTaskView),
              addToast,
              runMemoryExtraction: () => runMemoryExtractionTask(taskContext.currentProjectId, historyOverride || chatHistory, userKey).catch((err: any) => {
                console.error('[App] Background memory extraction failed:', err);
              }),
              playSuccessSound,
              useAsReference: handleUseAsReference
            },
            now: () => Date.now()
          }),
          playVisibleSuccess: () => {
            playVisibleSuccess();
          },
          onVisibleAsset: (asset: AssetItem) => {
            latestVisibleAssetRef.current = asset;
          },
          normalizeAssistantMode,
          now: () => Date.now()
        }
      }),
      resolvePrimaryReview: ({ review, genParams, reviewedToolResult, generatedArtifact, reviewArtifact, finalizedReviewStep, asset, taskRuntime, taskContext }: any) => resolvePrimaryReview({
        mode: currentMode,
        job: taskContext.getAgentJob(),
        finalizedReviewStep,
        generatedArtifact,
        reviewArtifact,
        review,
        prompt: genParams.prompt,
        reviewedToolResult,
        continuousMode: taskContext.activeParams.continuousMode,
        asset,
        deps: {
          resolvePrimaryReview: (job: AgentJob, shouldSyncTaskView: boolean) => taskRuntime.resolvePrimaryReview(job, shouldSyncTaskView),
          addToast,
          runMemoryExtraction: () => runMemoryExtractionTask(taskContext.currentProjectId, historyOverride || chatHistory, userKey).catch((err: any) => {
            console.error('[App] Background memory extraction failed:', err);
          }),
          playSuccessSound,
          useAsReference: handleUseAsReference
        },
        now: () => Date.now()
      }),
      resolveGenerationFailure: ({ error }: any) => resolveGenerationFailure({
        mode: currentMode,
        agentJob: getAgentJob(),
        stepId,
        taskId,
        latestVisibleAsset: latestVisibleAssetRef.current,
        taskMarkedVisibleComplete: taskMarkedVisibleCompleteRef.current,
        error,
        deps: {
          taskRuntime: {
            cancel: (job: AgentJob, id: string) => taskRuntime.cancel(job, id),
            recoverVisibleAsset: (nestedInput: any) => taskRuntime.recoverVisibleAsset(nestedInput),
            fail: (job: AgentJob) => taskRuntime.fail(job)
          },
          addToast,
          playErrorSound,
          setCooldown: setVideoCooldownEndTime,
          getFriendlyError,
          language,
          now: () => Date.now()
        }
      })
    }
  });
};
