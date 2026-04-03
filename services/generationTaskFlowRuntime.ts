import { AppMode, type AgentJob, type AgentToolResult, type AssetItem, type GenerationParams } from '../types';
import type { GenerationReviewPayload } from './generationOrchestrator';

export const executePreparedGenerationTask = async ({
  mode,
  agentJob,
  stepId,
  taskId,
  jobId,
  currentProjectId,
  activeParams,
  initialPendingAsset,
  signal,
  selectedReferenceRecords,
  historyForGeneration,
  deps
}: {
  mode: AppMode;
  agentJob: AgentJob;
  stepId: string;
  taskId: string;
  jobId: string;
  currentProjectId: string;
  activeParams: GenerationParams;
  initialPendingAsset: AssetItem;
  signal: AbortSignal;
  selectedReferenceRecords: unknown[];
  historyForGeneration?: unknown;
  deps: {
    stagePendingAsset: (asset: AssetItem) => Promise<unknown>;
    normalizeGenerationParams: () => GenerationParams;
    executeGenerationAttempt: (input: {
      genParams: GenerationParams;
      historyForGeneration?: unknown;
    }) => Promise<{ asset: AssetItem; toolResult: AgentToolResult }>;
    afterVisibleImage: (input: {
      asset: AssetItem;
    }) => Promise<unknown>;
    executePrimaryReview: (input: {
      asset: AssetItem;
      genParams: GenerationParams;
      toolResult: AgentToolResult;
    }) => Promise<{
      generatedArtifact: any;
      review: GenerationReviewPayload;
      reviewArtifact: any;
      finalizedReviewStep: any;
      reviewedToolResult: AgentToolResult;
    }>;
    executeAutoRevisionFlow: (input: {
      review: GenerationReviewPayload;
      genParams: GenerationParams;
      toolResult: AgentToolResult;
      generatedArtifact: any;
      reviewArtifact: any;
      finalizedReviewStep: any;
      selectedReferenceRecords: unknown[];
    }) => Promise<AgentToolResult>;
    resolvePrimaryReview: (input: {
      review: GenerationReviewPayload;
      genParams: GenerationParams;
      reviewedToolResult: AgentToolResult;
      generatedArtifact: any;
      reviewArtifact: any;
      finalizedReviewStep: any;
      asset: AssetItem;
    }) => Promise<AgentToolResult>;
    resolveGenerationFailure: (input: {
      error: Error;
      latestVisibleAsset: AssetItem | null;
      taskMarkedVisibleComplete: boolean;
    }) => Promise<{ toolResult: AgentToolResult; taskMarkedVisibleComplete: boolean }>;
  };
}): Promise<AgentToolResult> => {
  let latestVisibleAsset: AssetItem | null = null;
  let taskMarkedVisibleComplete = false;

  try {
    await deps.stagePendingAsset(initialPendingAsset);
    const genParams = deps.normalizeGenerationParams();
    const { asset, toolResult } = await deps.executeGenerationAttempt({
      genParams,
      historyForGeneration
    });
    latestVisibleAsset = asset;

    if (mode === AppMode.IMAGE) {
      if (signal.aborted) throw new Error('Cancelled');
      await deps.afterVisibleImage({ asset });
      taskMarkedVisibleComplete = true;
    }

    const {
      generatedArtifact,
      review,
      reviewArtifact,
      finalizedReviewStep,
      reviewedToolResult
    } = await deps.executePrimaryReview({
      asset,
      genParams,
      toolResult
    });

    if (review.decision === 'auto_revise' && mode === AppMode.IMAGE) {
      return deps.executeAutoRevisionFlow({
        review,
        genParams,
        toolResult,
        generatedArtifact,
        reviewArtifact,
        finalizedReviewStep,
        selectedReferenceRecords
      });
    }

    return deps.resolvePrimaryReview({
      review,
      genParams,
      reviewedToolResult,
      generatedArtifact,
      reviewArtifact,
      finalizedReviewStep,
      asset
    });
  } catch (error) {
    const failure = await deps.resolveGenerationFailure({
      error: error as Error,
      latestVisibleAsset,
      taskMarkedVisibleComplete
    });
    taskMarkedVisibleComplete = failure.taskMarkedVisibleComplete;
    return failure.toolResult;
  }
};
