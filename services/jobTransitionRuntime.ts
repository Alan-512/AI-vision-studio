import type { AgentJob, AgentToolResult, AssetItem, JobArtifact, JobStep } from '../types';
import type { RuntimeReviewPayload } from './agentRuntime';
import {
  buildGenerationExecutionSnapshot,
  buildGenerationOperationSnapshot,
  prepareAutoRevisionResolution,
  prepareCompletedGeneration,
  preparePrimaryReviewResolution
} from './agentRuntime';
import { preparePrimaryReview } from './generationOrchestrator';

export const transitionJobToGenerationRunning = ({
  job,
  stepId,
  now
}: {
  job: AgentJob;
  stepId: string;
  now: number;
}): AgentJob => buildGenerationExecutionSnapshot(job, {
  stepId,
  now
});

export const transitionJobGenerationOperation = ({
  job,
  stepId,
  operationName,
  now
}: {
  job: AgentJob;
  stepId: string;
  operationName: string;
  now: number;
}): AgentJob => buildGenerationOperationSnapshot(job, {
  stepId,
  operationName,
  now
});

export const transitionJobToGenerationCompleted = ({
  job,
  stepId,
  taskId,
  toolName,
  asset,
  now,
  extraOutput,
  extraMetadata,
  message
}: {
  job: AgentJob;
  stepId: string;
  taskId: string;
  toolName: AgentToolResult['toolName'];
  asset: AssetItem;
  now: number;
  extraOutput?: Record<string, unknown>;
  extraMetadata?: Record<string, unknown>;
  message?: string;
}) => prepareCompletedGeneration({
  job,
  stepId,
  taskId,
  toolName,
  asset,
  now,
  extraOutput,
  extraMetadata,
  message
});

export const transitionJobToPrimaryReview = ({
  job,
  asset,
  generationStepId,
  reviewStepId,
  toolResult,
  startedAt
}: {
  job: AgentJob;
  asset: AssetItem;
  generationStepId: string;
  reviewStepId: string;
  toolResult: AgentToolResult;
  startedAt: number;
}) => preparePrimaryReview({
  job,
  asset,
  generationStepId,
  reviewStepId,
  toolResult,
  startedAt
});

export const transitionPrimaryReviewResolution = ({
  job,
  finalizedReviewStep,
  generatedArtifact,
  reviewArtifact,
  review,
  defaultRequiresAction,
  now
}: {
  job: AgentJob;
  finalizedReviewStep: JobStep;
  generatedArtifact: JobArtifact;
  reviewArtifact: JobArtifact;
  review: RuntimeReviewPayload;
  defaultRequiresAction: NonNullable<AgentJob['requiresAction']>;
  now: number;
}) => preparePrimaryReviewResolution({
  job,
  finalizedReviewStep,
  generatedArtifact,
  reviewArtifact,
  review,
  defaultRequiresAction,
  now
});

export const transitionAutoRevisionResolution = ({
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
  defaultRequiresAction,
  now
}: {
  job: AgentJob;
  stepsAfterRevision: JobStep[];
  finalizedRevisedGenerationStep: JobStep;
  finalizedSecondReviewStep: JobStep;
  generatedArtifact: JobArtifact;
  reviewArtifact: JobArtifact;
  revisionArtifact: JobArtifact;
  revisedGeneratedArtifact: JobArtifact;
  secondReviewArtifact: JobArtifact;
  secondReview: RuntimeReviewPayload;
  defaultRequiresAction: NonNullable<AgentJob['requiresAction']>;
  now: number;
}) => prepareAutoRevisionResolution({
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
  defaultRequiresAction,
  now
});
