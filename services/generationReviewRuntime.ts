import type { AgentJob, AgentToolResult, AssetItem, GenerationParams, JobStep, RuntimeProjectionEvent } from '../types';
import type { ImageCriticContextInput } from './imageCriticService';
import type { LocalReviewResult } from './assetReviewRuntime';
import {
  buildDefaultRefinePromptRequiresAction,
  buildRevisedToolResult,
  finalizeReviewOutcome
} from './generationOrchestrator';
import { transitionJobToPrimaryReview } from './jobTransitionRuntime';

export const executePrimaryReview = async ({
  job,
  asset,
  generationStepId,
  toolResult,
  prompt,
  genParams,
  selectedReferences,
  assistantMode,
  taskRuntime,
  buildCriticContext,
  reviewAsset,
  now = () => Date.now(),
  createId = () => crypto.randomUUID()
}: {
  job: AgentJob;
  asset: AssetItem;
  generationStepId: string;
  toolResult: AgentToolResult;
  prompt: string;
  genParams: GenerationParams;
  selectedReferences: unknown[];
  assistantMode?: unknown;
  taskRuntime: {
    startReview: (job: AgentJob, shouldSyncTaskView: boolean) => Promise<unknown>;
  };
  buildCriticContext: (input: {
    assistantMode: unknown;
    negativePrompt?: string;
    selectedReferences: unknown[];
    consistencyProfile?: AgentJob['consistencyProfile'];
    searchContext?: AgentJob['searchContext'];
  }) => ImageCriticContextInput;
  reviewAsset: (asset: AssetItem, prompt: string, context?: ImageCriticContextInput) => Promise<LocalReviewResult>;
  now?: () => number;
  createId?: () => string;
}) => {
  const runtimeEvents: RuntimeProjectionEvent[] = [];
  const reviewStepId = createId();
  const reviewStartedAt = now();
  const {
    generatedArtifact,
    reviewStep,
    reviewingJob
  } = transitionJobToPrimaryReview({
    job,
    asset,
    generationStepId,
    reviewStepId,
    toolResult,
    startedAt: reviewStartedAt
  });

  taskRuntime.startReview(reviewingJob, asset.type !== 'IMAGE')
    .then((result: any) => {
      if (Array.isArray(result?.events)) {
        runtimeEvents.push(...result.events);
      }
    })
    .catch(console.error);

  const criticContext = buildCriticContext({
    assistantMode,
    negativePrompt: genParams.negativePrompt,
    selectedReferences,
    consistencyProfile: job.consistencyProfile,
    searchContext: job.searchContext
  });
  const review = await reviewAsset(asset, prompt, criticContext);

  const reviewArtifactId = createId();
  const reviewEndedAt = now();
  const {
    reviewArtifact,
    finalizedReviewStep,
    reviewedToolResult
  } = finalizeReviewOutcome({
    artifactId: reviewArtifactId,
    reviewStep,
    review,
    toolResult,
    endedAt: reviewEndedAt
  });

  return {
    generatedArtifact,
    reviewStep,
    reviewingJob,
    review,
    reviewArtifact,
    finalizedReviewStep,
    reviewedToolResult,
    runtimeEvents
  };
};

export const executeAutoRevisionReview = async ({
  revisedAsset,
  revisedPrompt,
  revisedParams,
  assistantMode,
  selectedReferences,
  job,
  secondReviewStep,
  toolResult,
  revisionStepId,
  reviewSummary,
  taskRuntime,
  now = () => Date.now(),
  createId = () => crypto.randomUUID()
}: {
  revisedAsset: AssetItem;
  revisedPrompt: string;
  revisedParams: GenerationParams;
  assistantMode?: unknown;
  selectedReferences: unknown[];
  job: AgentJob;
  secondReviewStep: JobStep;
  toolResult: AgentToolResult;
  revisionStepId: string;
  reviewSummary: string;
  taskRuntime: {
    buildCriticContext: (input: {
      assistantMode: unknown;
      negativePrompt?: string;
      selectedReferences: unknown[];
      consistencyProfile?: AgentJob['consistencyProfile'];
      searchContext?: AgentJob['searchContext'];
    }) => ImageCriticContextInput;
    reviewAsset: (asset: AssetItem, prompt: string, context?: ImageCriticContextInput) => Promise<LocalReviewResult>;
    buildDefaultRequiresAction: (input: {
      prompt: string;
      latestAssetId: string;
      review: Pick<LocalReviewResult, 'summary' | 'warnings' | 'revisedPrompt' | 'reviewPlan' | 'reviewTrace' | 'quality' | 'issues'>;
    }) => {
      type: string;
      message: string;
      payload?: Record<string, unknown>;
    };
  };
  now?: () => number;
  createId?: () => string;
}) => {
  const secondReview = await taskRuntime.reviewAsset(
    revisedAsset,
    revisedPrompt,
    taskRuntime.buildCriticContext({
      assistantMode,
      negativePrompt: revisedParams.negativePrompt,
      selectedReferences,
      consistencyProfile: job.consistencyProfile,
      searchContext: job.searchContext
    })
  );

  const secondReviewArtifactId = createId();
  const secondReviewRequiresAction = secondReview.decision === 'requires_action'
    ? (secondReview.requiresAction || taskRuntime.buildDefaultRequiresAction({
      prompt: revisedPrompt,
      latestAssetId: revisedAsset.id,
      review: secondReview
    }))
    : undefined;

  const {
    reviewArtifact: secondReviewArtifact,
    finalizedReviewStep: finalizedSecondReviewStep,
    reviewedToolResult: revisedBaseToolResult
  } = finalizeReviewOutcome({
    artifactId: secondReviewArtifactId,
    reviewStep: secondReviewStep,
    review: secondReview,
    toolResult,
    endedAt: now(),
    toolResultOptions: {
      artifactIds: [revisedAsset.id],
      acceptStatus: 'success',
      nonAcceptStatus: 'requires_action',
      requiresAction: secondReviewRequiresAction
    }
  });

  const revisedToolResult = buildRevisedToolResult({
    baseToolResult: revisedBaseToolResult,
    revisedPrompt,
    revisionStepId,
    revisionReason: reviewSummary,
    secondReview,
    secondReviewStepId: secondReviewStep.id
  });

  return {
    secondReview,
    secondReviewArtifact,
    finalizedSecondReviewStep,
    revisedToolResult
  };
};
