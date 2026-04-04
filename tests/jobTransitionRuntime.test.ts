import { describe, expect, it } from 'vitest';
import { AppMode, AspectRatio, ImageModel, ImageResolution, ImageStyle, type AgentJob, type AgentToolResult, type AssetItem, type JobArtifact, type JobStep } from '../types';
import {
  transitionAutoRevisionResolution,
  transitionJobGenerationOperation,
  transitionJobToGenerationCompleted,
  transitionJobToGenerationRunning,
  transitionJobToPrimaryReview,
  transitionPrimaryReviewResolution
} from '../services/jobTransitionRuntime';

const createJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'queued',
  createdAt: 100,
  updatedAt: 100,
  source: 'chat',
  steps: [{
    id: 'step-1',
    kind: 'generation',
    name: 'generate_image',
    status: 'pending',
    input: {
      prompt: 'poster'
    }
  }],
  artifacts: [],
  ...overrides
});

const createAsset = (overrides: Partial<AssetItem> = {}): AssetItem => ({
  id: 'asset-1',
  projectId: 'project-1',
  type: 'IMAGE',
  url: 'blob://asset',
  prompt: 'poster',
  createdAt: 100,
  status: 'COMPLETED',
  metadata: {
    model: ImageModel.FLASH_3_1,
    aspectRatio: AspectRatio.SQUARE
  },
  ...overrides
});

const createToolResult = (): AgentToolResult => ({
  toolName: 'generate_image',
  status: 'success',
  artifactIds: ['asset-1'],
  message: 'done'
});

describe('jobTransitionRuntime', () => {
  it('centralizes generation running and operation transitions', () => {
    const running = transitionJobToGenerationRunning({
      job: createJob(),
      stepId: 'step-1',
      now: 200
    });
    const withOperation = transitionJobGenerationOperation({
      job: running,
      stepId: 'step-1',
      operationName: 'op-1',
      now: 220
    });

    expect(running.status).toBe('executing');
    expect(running.currentStepId).toBe('step-1');
    expect(withOperation.steps[0].output).toMatchObject({
      operationName: 'op-1'
    });
  });

  it('produces primary review and review resolution transitions', () => {
    const runningJob = transitionJobToGenerationRunning({
      job: createJob(),
      stepId: 'step-1',
      now: 120
    });
    const { reviewingJob, generatedArtifact, reviewStep } = transitionJobToPrimaryReview({
      job: runningJob,
      asset: createAsset(),
      generationStepId: 'step-1',
      reviewStepId: 'review-step-1',
      toolResult: createToolResult(),
      startedAt: 150
    });
    const reviewArtifact: JobArtifact = {
      id: 'review-artifact',
      type: 'text',
      origin: 'review',
      role: 'review_note',
      createdAt: 160
    };
    const finalizedReviewStep: JobStep = {
      ...reviewStep,
      status: 'success',
      endTime: 180
    };

    const { resolution, resolvedJob } = transitionPrimaryReviewResolution({
      job: reviewingJob,
      finalizedReviewStep,
      generatedArtifact,
      reviewArtifact,
      review: {
        decision: 'accept',
        summary: 'looks good',
        warnings: []
      },
      defaultRequiresAction: {
        type: 'review_output',
        message: 'continue'
      },
      now: 200
    });

    expect(reviewingJob.status).toBe('reviewing');
    expect(resolution).toBe('completed');
    expect(resolvedJob.status).toBe('completed');
  });

  it('normalizes auto revision resolution to requires_action when second review does not accept', () => {
    const stepsAfterRevision: JobStep[] = [{
      id: 'revision-step',
      kind: 'revision',
      name: 'revise_generation_prompt',
      status: 'success',
      input: {},
      output: {}
    }];

    const { resolution, resolvedJob } = transitionAutoRevisionResolution({
      job: createJob({
        status: 'reviewing',
        currentStepId: 'review-step-2'
      }),
      stepsAfterRevision,
      finalizedRevisedGenerationStep: {
        id: 'gen-step-2',
        kind: 'generation',
        name: 'generate_image',
        status: 'success',
        input: {},
        output: {}
      },
      finalizedSecondReviewStep: {
        id: 'review-step-2',
        kind: 'review',
        name: 'review_output',
        status: 'failed',
        input: {},
        output: {}
      },
      generatedArtifact: {
        id: 'generated-1',
        type: 'image',
        origin: 'generated',
        role: 'final',
        createdAt: 100
      },
      reviewArtifact: {
        id: 'review-1',
        type: 'text',
        origin: 'review',
        role: 'review_note',
        createdAt: 110
      },
      revisionArtifact: {
        id: 'revision-1',
        type: 'text',
        origin: 'system',
        role: 'review_note',
        createdAt: 120
      },
      revisedGeneratedArtifact: {
        id: 'generated-2',
        type: 'image',
        origin: 'generated',
        role: 'final',
        createdAt: 130
      },
      secondReviewArtifact: {
        id: 'review-2',
        type: 'text',
        origin: 'review',
        role: 'review_note',
        createdAt: 140
      },
      secondReview: {
        decision: 'requires_action',
        summary: 'needs more changes',
        warnings: []
      },
      defaultRequiresAction: {
        type: 'refine_prompt',
        message: 'continue'
      },
      now: 200
    });

    expect(resolution).toBe('requires_action');
    expect(resolvedJob.status).toBe('requires_action');
    expect(resolvedJob.requiresAction?.type).toBe('refine_prompt');
  });
});
