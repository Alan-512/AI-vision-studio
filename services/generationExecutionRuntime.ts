import { AppMode, type AgentJob, type AgentToolResult, type AssetItem, type GenerationParams, type JobStep, type RuntimeProjectionEvent } from '../types';
import { buildAutoRevisionReviewHandoff } from './generationOrchestrator';
import {
  transitionJobGenerationOperation,
  transitionJobToGenerationCompleted,
  transitionJobToGenerationRunning
} from './jobTransitionRuntime';

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
}): Promise<{ asset: AssetItem; toolResult: AgentToolResult; runtimeEvents: RuntimeProjectionEvent[] }> => {
  const runtimeEvents: RuntimeProjectionEvent[] = [];
  let stageRunningPromise: Promise<void> | null = null;
  const onStart = () => {
    const runningAt = now();
    const runningJob = transitionJobToGenerationRunning({
      job: agentJob,
      stepId,
      now: runningAt
    });
    const assetPatch = { status: 'GENERATING' as const };
    const assetViewPatch = { status: 'GENERATING' as const };
    if (stageRunningPromise) {
      return;
    }
    stageRunningPromise =
      taskRuntime.stageRunningJob({
        runningJob,
        assetPatch,
        assetViewPatch
      }).then((result: any) => {
        if (Array.isArray(result?.events)) {
          runtimeEvents.push(...result.events);
        }
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
    const { completedJob, toolResult } = transitionJobToGenerationCompleted({
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
    const completed = await taskRuntime.completeVisibleImage({
      asset,
      completedJob
    });
    await stageRunningPromise;
    if (Array.isArray((completed as any)?.events)) {
      runtimeEvents.push(...(completed as any).events);
    }
    return { asset, toolResult, runtimeEvents };
  }

  const videoResult = await generateVideoImpl(
    genParams,
    async operationName => {
      if (signal.aborted) throw new Error('Cancelled');
      const jobWithOperation = transitionJobGenerationOperation({
        job: agentJob,
        stepId,
        operationName,
        now: now()
      });
      const assetPatch = { operationName };
      const operationUpdate = await taskRuntime.updateOperation({
        operationJob: jobWithOperation,
        assetPatch
      });
      if (Array.isArray((operationUpdate as any)?.events)) {
        runtimeEvents.push(...(operationUpdate as any).events);
      }
    },
    onStart,
    signal
  );
  if (signal.aborted) throw new Error('Cancelled');
  const updates = { status: 'COMPLETED' as const, url: videoResult.blobUrl, videoUri: videoResult.videoUri, isNew: true };
  const asset = { ...initialPendingAsset, ...updates, jobId };
  const completedAt = now();
  const { completedJob, toolResult } = transitionJobToGenerationCompleted({
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
  const completed = await taskRuntime.completeVideo({
    assetUpdates: updates,
    completedJob
  });
  await stageRunningPromise;
  if (Array.isArray((completed as any)?.events)) {
    runtimeEvents.push(...(completed as any).events);
  }
  return { asset, toolResult, runtimeEvents };
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
  const runtimeEvents: RuntimeProjectionEvent[] = [];
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
  const published = await taskRuntime.publishAssetAndPersistJob({
    asset: revisedAsset,
    job: reviewingRevisionJob
  });
  if (Array.isArray((published as any)?.events)) {
    runtimeEvents.push(...(published as any).events);
  }

  return {
    revisedAsset,
    finalizedRevisedGenerationStep,
    revisedGeneratedArtifact,
    secondReviewStep,
    reviewingRevisionJob,
    runtimeEvents
  };
};
