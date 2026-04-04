import { AppMode, type AgentAction, type AgentJob, type AgentToolResult, type GenerationParams, type JobArtifact, type JobStep, type RuntimeProjectionEvent } from '../types';
import type { GenerationReviewPayload } from './generationOrchestrator';
import { buildAutoRevisionExecutionHandoff } from './generationOrchestrator';

export const executeAutoRevisionFlow = async ({
  job,
  review,
  currentMode,
  originalPrompt,
  genParams,
  toolCall,
  finalizedReviewStep,
  reviewArtifact,
  generatedArtifact,
  currentProjectId,
  signal,
  taskId,
  jobId,
  toolResult,
  selectedReferences,
  historyForGeneration,
  continuousMode,
  taskRuntime,
  deps
}: {
  job: AgentJob;
  review: GenerationReviewPayload;
  currentMode: AppMode;
  originalPrompt: string;
  genParams: GenerationParams;
  toolCall?: AgentAction;
  finalizedReviewStep: JobStep;
  reviewArtifact: JobArtifact;
  generatedArtifact: JobArtifact;
  currentProjectId: string;
  signal: AbortSignal;
  taskId: string;
  jobId: string;
  toolResult: AgentToolResult;
  selectedReferences: unknown[];
  historyForGeneration?: unknown;
  continuousMode?: boolean;
  taskRuntime: {
    startAutoRevision: (jobs: AgentJob[]) => Promise<unknown>;
  };
  deps: {
    executeAttempt: (input: {
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
      secondReviewStepId: string;
      historyForGeneration?: unknown;
    }) => Promise<{
      revisedAsset: any;
      finalizedRevisedGenerationStep: JobStep;
      revisedGeneratedArtifact: JobArtifact;
      secondReviewStep: JobStep;
      reviewingRevisionJob: AgentJob;
    }>;
    executeReview: (input: {
      revisedAsset: any;
      revisedPrompt: string;
      revisedParams: GenerationParams;
      assistantMode?: unknown;
      selectedReferences: unknown[];
      job: AgentJob;
      secondReviewStep: JobStep;
      toolResult: AgentToolResult;
      revisionStepId: string;
      reviewSummary: string;
    }) => Promise<{
      secondReview: GenerationReviewPayload;
      secondReviewArtifact: JobArtifact;
      finalizedSecondReviewStep: JobStep;
      revisedToolResult: AgentToolResult;
    }>;
    resolveAutoRevision: (input: {
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
      revisedAsset?: any;
    }) => Promise<AgentToolResult>;
    playVisibleSuccess: () => void;
    onVisibleAsset?: (asset: any) => void;
    normalizeAssistantMode: (value: unknown) => unknown;
    now?: () => number;
    createId?: () => string;
  };
}) => {
  const runtimeEvents: RuntimeProjectionEvent[] = [];
  const now = deps.now || (() => Date.now());
  const createId = deps.createId || (() => crypto.randomUUID());
  const revisionStepId = createId();
  const revisionArtifactId = createId();
  const revisedGenerationStepId = createId();
  const {
    revisionArtifact,
    revisingJob,
    stepsAfterRevision,
    revisedPrompt,
    revisedParams,
    revisedGenerationStep,
    executingRevisionJob
  } = buildAutoRevisionExecutionHandoff({
    job,
    review,
    currentMode,
    originalPrompt,
    genParams,
    toolCall,
    finalizedReviewStep,
    reviewArtifact,
    revisionStepId,
    revisionArtifactId,
    revisedGenerationStepId,
    revisionStartedAt: now(),
    now: now()
  });

  const autoRevisionStart = await taskRuntime.startAutoRevision([revisingJob, executingRevisionJob]);
  if (Array.isArray(autoRevisionStart)) {
    for (const result of autoRevisionStart) {
      if (Array.isArray((result as any)?.events)) {
        runtimeEvents.push(...(result as any).events);
      }
    }
  }

  const secondReviewStepId = createId();
  const {
    revisedAsset,
    finalizedRevisedGenerationStep,
    revisedGeneratedArtifact,
    secondReviewStep,
    runtimeEvents: attemptEvents = []
  } = await deps.executeAttempt({
    executingRevisionJob,
    stepsAfterRevision,
    revisedGenerationStep,
    revisedGenerationStepId,
    revisedParams,
    currentProjectId,
    signal,
    taskId,
    jobId,
    parentArtifactId: generatedArtifact.id,
    toolResult,
    secondReviewStepId,
    historyForGeneration
  });

  deps.onVisibleAsset?.(revisedAsset);
  if (signal.aborted) throw new Error('Cancelled');
  deps.playVisibleSuccess();

  const {
    secondReview,
    secondReviewArtifact,
    finalizedSecondReviewStep,
    revisedToolResult,
    runtimeEvents: reviewEvents = []
  } = await deps.executeReview({
    revisedAsset,
    revisedPrompt,
    revisedParams,
    assistantMode: deps.normalizeAssistantMode((revisedParams as any).assistant_mode),
    selectedReferences,
    job,
    secondReviewStep,
    toolResult,
    revisionStepId,
    reviewSummary: review.revisionReason || review.summary
  });

  const resolved = await deps.resolveAutoRevision({
    mode: currentMode,
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
    revisedAssetId: revisedAsset.id,
    revisedToolResult,
    continuousMode,
    revisedAsset
  });

  const resolutionEvents = Array.isArray((resolved as any)?.runtimeEvents) ? (resolved as any).runtimeEvents : [];
  runtimeEvents.push(...attemptEvents, ...reviewEvents, ...resolutionEvents);

  if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
    return {
      ...(resolved as Record<string, unknown>),
      runtimeEvents
    } as AgentToolResult;
  }

  return resolved;
};
