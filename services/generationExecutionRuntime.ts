import { AppMode, type AgentJob, type AgentToolResult, type AssetItem, type GenerationParams, type JobStep } from '../types';
import { buildAutoRevisionReviewHandoff } from './generationOrchestrator';
import { prepareCompletedGeneration, buildGenerationExecutionSnapshot, buildGenerationOperationSnapshot } from './agentRuntime';

export const executeGenerationAttempt = async ({
  mode,
  agentJob,
  stepId,
  taskId,
  jobId,
  currentProjectId,
  genParams,
  initialPendingAsset,
  signal,
  taskRuntime,
  generateImageImpl,
  generateVideoImpl,
  historyForGeneration,
  onThoughtImage,
  now = () => Date.now()
}: {
  mode: AppMode;
  agentJob: AgentJob;
  stepId: string;
  taskId: string;
  jobId: string;
  currentProjectId: string;
  genParams: GenerationParams;
  initialPendingAsset: AssetItem;
  signal: AbortSignal;
  taskRuntime: {
    stageRunningJob: (input: {
      runningJob: AgentJob;
      assetPatch: Partial<AssetItem>;
      assetViewPatch?: Partial<AssetItem>;
    }) => Promise<unknown>;
    completeVisibleImage: (input: {
      asset: AssetItem;
      completedJob: AgentJob;
    }) => Promise<unknown>;
    updateOperation: (input: {
      operationJob: AgentJob;
      assetPatch: Partial<AssetItem>;
    }) => Promise<unknown>;
    completeVideo: (input: {
      assetUpdates: Partial<AssetItem>;
      completedJob: AgentJob;
    }) => Promise<unknown>;
  };
  generateImageImpl: (
    params: GenerationParams,
    projectId: string,
    onStart: () => void,
    signal: AbortSignal,
    taskId: string,
    historyForGeneration?: any,
    onThoughtImage?: (imageData: any) => void
  ) => Promise<AssetItem>;
  generateVideoImpl: (
    params: GenerationParams,
    onUpdate: (operationName: string) => Promise<void>,
    onStart: () => void,
    signal: AbortSignal
  ) => Promise<{ blobUrl: string; videoUri?: string }>;
  historyForGeneration?: any;
  onThoughtImage?: (imageData: any) => void;
  now?: () => number;
}): Promise<{ asset: AssetItem; toolResult: AgentToolResult }> => {
  const onStart = () => {
    const runningAt = now();
    const runningJob = buildGenerationExecutionSnapshot(agentJob, {
      stepId,
      now: runningAt
    });
    const assetPatch = { status: 'GENERATING' as const };
    const assetViewPatch = { status: 'GENERATING' as const };
    taskRuntime.stageRunningJob({
      runningJob,
      assetPatch,
      assetViewPatch
    }).catch(console.error);
  };

  if (mode === AppMode.IMAGE) {
    const asset = await generateImageImpl(
      genParams,
      currentProjectId,
      onStart,
      signal,
      taskId,
      historyForGeneration,
      onThoughtImage
    );
    if (signal.aborted) throw new Error('Cancelled');
    asset.isNew = true;
    asset.jobId = jobId;
    const completedAt = now();
    const { completedJob, toolResult } = prepareCompletedGeneration({
      job: agentJob,
      stepId,
      taskId,
      toolName: 'generate_image',
      asset,
      now: completedAt,
      message: 'Image generation completed',
      extraMetadata: {
        model: asset.metadata?.model,
        aspectRatio: asset.metadata?.aspectRatio
      }
    });
    await taskRuntime.completeVisibleImage({
      asset,
      completedJob
    });
    return { asset, toolResult };
  }

  const videoResult = await generateVideoImpl(
    genParams,
    async operationName => {
      if (signal.aborted) throw new Error('Cancelled');
      const jobWithOperation = buildGenerationOperationSnapshot(agentJob, {
        stepId,
        operationName,
        now: now()
      });
      const assetPatch = { operationName };
      await taskRuntime.updateOperation({
        operationJob: jobWithOperation,
        assetPatch
      });
    },
    onStart,
    signal
  );
  if (signal.aborted) throw new Error('Cancelled');
  const updates = { status: 'COMPLETED' as const, url: videoResult.blobUrl, videoUri: videoResult.videoUri, isNew: true };
  const asset = { ...initialPendingAsset, ...updates, jobId };
  const completedAt = now();
  const { completedJob, toolResult } = prepareCompletedGeneration({
    job: agentJob,
    stepId,
    taskId,
    toolName: 'generate_video',
    asset,
    now: completedAt,
    message: 'Video generation completed',
    extraOutput: { videoUri: videoResult.videoUri },
    extraMetadata: {
      videoUri: videoResult.videoUri
    }
  });
  await taskRuntime.completeVideo({
    assetUpdates: updates,
    completedJob
  });
  return { asset, toolResult };
};

export const executeAutoRevisionAttempt = async ({
  executingRevisionJob,
  stepsAfterRevision,
  revisedGenerationStep,
  revisedGenerationStepId,
  revisedParams,
  currentProjectId,
  signal,
  taskId,
  jobId,
  parentArtifactId,
  toolResult,
  taskRuntime,
  generateImageImpl,
  secondReviewStepId,
  historyForGeneration,
  onThoughtImage,
  now = () => Date.now()
}: {
  executingRevisionJob: AgentJob;
  stepsAfterRevision: JobStep[];
  revisedGenerationStep: JobStep;
  revisedGenerationStepId: string;
  revisedParams: GenerationParams;
  currentProjectId: string;
  signal: AbortSignal;
  taskId: string;
  jobId: string;
  parentArtifactId: string;
  toolResult: AgentToolResult;
  taskRuntime: {
    publishAssetAndPersistJob: (input: {
      asset: AssetItem;
      job: AgentJob;
    }) => Promise<unknown>;
  };
  generateImageImpl: (
    params: GenerationParams,
    projectId: string,
    onStart: () => void,
    signal: AbortSignal,
    taskId: string,
    historyForGeneration?: any,
    onThoughtImage?: (imageData: any) => void
  ) => Promise<AssetItem>;
  secondReviewStepId: string;
  historyForGeneration?: any;
  onThoughtImage?: (imageData: any) => void;
  now?: () => number;
}) => {
  const revisedAsset = await generateImageImpl(
    revisedParams,
    currentProjectId,
    () => {},
    signal,
    taskId,
    historyForGeneration,
    onThoughtImage
  );
  if (signal.aborted) throw new Error('Cancelled');
  revisedAsset.isNew = true;
  revisedAsset.jobId = jobId;
  const {
    finalizedRevisedGenerationStep,
    revisedGeneratedArtifact,
    secondReviewStep,
    reviewingRevisionJob
  } = buildAutoRevisionReviewHandoff({
    executingRevisionJob,
    stepsAfterRevision,
    revisedGenerationStep,
    revisedGenerationStepId,
    revisedAsset,
    parentArtifactId,
    secondReviewStepId,
    toolResult,
    now: now()
  });
  await taskRuntime.publishAssetAndPersistJob({
    asset: revisedAsset,
    job: reviewingRevisionJob
  });

  return {
    revisedAsset,
    finalizedRevisedGenerationStep,
    revisedGeneratedArtifact,
    secondReviewStep,
    reviewingRevisionJob
  };
};
