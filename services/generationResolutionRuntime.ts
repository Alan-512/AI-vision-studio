import { AppMode, type AgentJob, type AgentToolResult, type AssetItem, type JobArtifact, type JobStep } from '../types';
import type { GenerationReviewPayload } from './generationOrchestrator';
import { buildDefaultPrimaryReviewRequiresAction, buildDefaultRefinePromptRequiresAction } from './generationOrchestrator';
import { transitionAutoRevisionResolution, transitionPrimaryReviewResolution } from './jobTransitionRuntime';

type ResolutionDeps = {
  addToast: (level: 'info' | 'error' | 'success', title: string, message: string) => void;
  runMemoryExtraction: () => Promise<void>;
  playSuccessSound: () => void;
  useAsReference: (asset: AssetItem, append?: boolean) => void;
};

export const resolvePrimaryReviewOutcome = async ({
  mode,
  blockedJob,
  completedJob,
  reviewedToolResult,
  reviewSummary,
  continuousMode,
  asset,
  deps
}: {
  mode: AppMode;
  blockedJob?: AgentJob;
  completedJob?: AgentJob;
  reviewedToolResult: AgentToolResult;
  reviewSummary: string;
  continuousMode?: boolean;
  asset?: AssetItem;
  deps: ResolutionDeps & {
    resolvePrimaryReview: (job: AgentJob, shouldSyncTaskView: boolean) => Promise<unknown>;
  };
}): Promise<AgentToolResult> => {
  const shouldSyncTaskView = mode !== AppMode.IMAGE;
  const runtimeEvents: unknown[] = [];

  if (blockedJob) {
    const result = await deps.resolvePrimaryReview(blockedJob, shouldSyncTaskView);
    if (Array.isArray((result as any)?.events)) {
      runtimeEvents.push(...(result as any).events);
    }
    deps.addToast('info', 'Refinement Suggestion', reviewSummary);
    return {
      ...reviewedToolResult,
      metadata: {
        ...(reviewedToolResult.metadata || {}),
        runtimeEvents,
        jobSnapshot: blockedJob
      }
    };
  }

  if (!completedJob) {
    return reviewedToolResult;
  }

  const result = await deps.resolvePrimaryReview(completedJob, shouldSyncTaskView);
  if (Array.isArray((result as any)?.events)) {
    runtimeEvents.push(...(result as any).events);
  }
  if (mode === AppMode.IMAGE) {
    await deps.runMemoryExtraction();
  } else {
    deps.playSuccessSound();
  }
  if (continuousMode && asset?.type === 'IMAGE') {
    deps.useAsReference(asset, false);
  }
  return {
    ...reviewedToolResult,
    metadata: {
      ...(reviewedToolResult.metadata || {}),
      runtimeEvents,
      jobSnapshot: completedJob
    }
  };
};

export const resolvePrimaryReview = async ({
  mode,
  job,
  finalizedReviewStep,
  generatedArtifact,
  reviewArtifact,
  review,
  prompt,
  reviewedToolResult,
  continuousMode,
  asset,
  deps,
  now = () => Date.now()
}: {
  mode: AppMode;
  job: AgentJob;
  finalizedReviewStep: JobStep;
  generatedArtifact: JobArtifact;
  reviewArtifact: JobArtifact;
  review: GenerationReviewPayload;
  prompt: string;
  reviewedToolResult: AgentToolResult;
  continuousMode?: boolean;
  asset?: AssetItem;
  deps: ResolutionDeps & {
    resolvePrimaryReview: (job: AgentJob, shouldSyncTaskView: boolean) => Promise<unknown>;
  };
  now?: () => number;
}): Promise<AgentToolResult> => {
  const { resolvedJob } = transitionPrimaryReviewResolution({
    job,
    finalizedReviewStep,
    generatedArtifact,
    reviewArtifact,
    review,
    defaultRequiresAction: review.requiresAction || buildDefaultPrimaryReviewRequiresAction({
      prompt,
      review
    }),
    now: now()
  });

  if (review.decision === 'requires_action') {
    return resolvePrimaryReviewOutcome({
      mode,
      blockedJob: resolvedJob,
      reviewedToolResult,
      reviewSummary: review.summary,
      deps
    });
  }

  return resolvePrimaryReviewOutcome({
    mode,
    completedJob: resolvedJob,
    reviewedToolResult,
    reviewSummary: review.summary,
    continuousMode,
    asset,
    deps
  });
};

export const resolveAutoRevisionOutcome = async ({
  mode,
  resolution,
  resolvedJob,
  revisedToolResult,
  reviewSummary,
  continuousMode,
  revisedAsset,
  deps
}: {
  mode: AppMode;
  resolution: 'requires_action' | 'completed';
  resolvedJob: AgentJob;
  revisedToolResult: AgentToolResult;
  reviewSummary: string;
  continuousMode?: boolean;
  revisedAsset?: AssetItem;
  deps: ResolutionDeps & {
    resolveAutoRevision: (job: AgentJob, shouldSyncTaskView: boolean) => Promise<unknown>;
  };
}): Promise<AgentToolResult> => {
  const shouldSyncTaskView = mode !== AppMode.IMAGE;
  const runtimeEvents: unknown[] = [];
  const result = await deps.resolveAutoRevision(resolvedJob, shouldSyncTaskView);
  if (Array.isArray((result as any)?.events)) {
    runtimeEvents.push(...(result as any).events);
  }

  if (resolution === 'requires_action') {
    deps.addToast('info', 'Refinement Suggestion', reviewSummary);
    return {
      ...revisedToolResult,
      metadata: {
        ...(revisedToolResult.metadata || {}),
        runtimeEvents,
        jobSnapshot: resolvedJob
      }
    };
  }

  await deps.runMemoryExtraction();
  if (mode !== AppMode.IMAGE) {
    deps.playSuccessSound();
  }
  if (continuousMode && revisedAsset) {
    deps.useAsReference(revisedAsset, false);
  }
  return {
    ...revisedToolResult,
    metadata: {
      ...(revisedToolResult.metadata || {}),
      runtimeEvents,
      jobSnapshot: resolvedJob
    }
  };
};

export const resolveAutoRevision = async ({
  mode,
  job,
  stepsAfterRevision,
  finalizedRevisedGenerationStep,
  finalizedSecondReviewStep,
  generatedArtifact,
  reviewArtifact,
  revisionArtifact,
  revisedGeneratedArtifact,
  secondReviewArtifact,
  secondReview,
  revisedPrompt,
  revisedAssetId,
  revisedToolResult,
  continuousMode,
  revisedAsset,
  deps,
  now = () => Date.now()
}: {
  mode: AppMode;
  job: AgentJob;
  stepsAfterRevision: JobStep[];
  finalizedRevisedGenerationStep: JobStep;
  finalizedSecondReviewStep: JobStep;
  generatedArtifact: JobArtifact;
  reviewArtifact: JobArtifact;
  revisionArtifact: JobArtifact;
  revisedGeneratedArtifact: JobArtifact;
  secondReviewArtifact: JobArtifact;
  secondReview: GenerationReviewPayload;
  revisedPrompt: string;
  revisedAssetId: string;
  revisedToolResult: AgentToolResult;
  continuousMode?: boolean;
  revisedAsset?: AssetItem;
  deps: ResolutionDeps & {
    resolveAutoRevision: (job: AgentJob, shouldSyncTaskView: boolean) => Promise<unknown>;
  };
  now?: () => number;
}): Promise<AgentToolResult> => {
  const { resolvedJob, resolution } = transitionAutoRevisionResolution({
    job,
    stepsAfterRevision,
    finalizedRevisedGenerationStep,
    finalizedSecondReviewStep,
    generatedArtifact,
    reviewArtifact,
    revisionArtifact,
    revisedGeneratedArtifact,
    secondReviewArtifact,
    secondReview,
    defaultRequiresAction: revisedToolResult.requiresAction || buildDefaultRefinePromptRequiresAction({
      prompt: revisedPrompt,
      latestAssetId: revisedAssetId,
      review: secondReview
    }),
    now: now()
  });

  return resolveAutoRevisionOutcome({
    mode,
    resolution,
    resolvedJob,
    revisedToolResult,
    reviewSummary: secondReview.summary,
    continuousMode,
    revisedAsset,
    deps
  });
};
