import { describe, expect, it, vi } from 'vitest';
import { AppMode, type AgentJob, type AgentToolResult, type AssetItem, type JobArtifact, type JobStep } from '../types';
import { resolveAutoRevision, resolveAutoRevisionOutcome, resolvePrimaryReview, resolvePrimaryReviewOutcome } from '../services/generationResolutionRuntime';

const createJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'queued',
  createdAt: 1710000000000,
  updatedAt: 1710000000001,
  source: 'studio',
  steps: [],
  artifacts: [],
  ...overrides
});

const createAsset = (overrides: Partial<AssetItem> = {}): AssetItem => ({
  id: 'asset-1',
  projectId: 'project-1',
  type: 'IMAGE',
  url: 'blob://asset',
  prompt: 'poster',
  createdAt: 1710000000000,
  status: 'COMPLETED',
  ...overrides
});

const createToolResult = (overrides: Partial<AgentToolResult> = {}): AgentToolResult => ({
  status: 'success',
  toolName: 'generate_image',
  message: 'done',
  ...overrides
});

const createArtifact = (overrides: Partial<JobArtifact> = {}): JobArtifact => ({
  id: 'artifact-1',
  kind: 'generated_asset',
  label: 'Generated Asset',
  createdAt: 1710000000000,
  ...overrides
});

const createStep = (overrides: Partial<JobStep> = {}): JobStep => ({
  id: 'step-1',
  kind: 'review',
  name: 'review_output',
  status: 'success',
  startTime: 1710000000000,
  endTime: 1710000000100,
  input: {},
  output: {},
  ...overrides
});

describe('generationResolutionRuntime', () => {
  it('handles primary review requires_action by syncing the blocked job and showing a suggestion toast', async () => {
    const resolvePrimaryReview = vi.fn().mockResolvedValue(undefined);
    const addToast = vi.fn();
    const reviewedToolResult = createToolResult({ status: 'requires_action' });

    const result = await resolvePrimaryReviewOutcome({
      mode: AppMode.IMAGE,
      blockedJob: createJob({ status: 'requires_action' }),
      reviewedToolResult,
      reviewSummary: 'Need confirmation',
      deps: {
        resolvePrimaryReview,
        addToast,
        runMemoryExtraction: vi.fn(),
        playSuccessSound: vi.fn(),
        useAsReference: vi.fn()
      }
    });

    expect(resolvePrimaryReview).toHaveBeenCalledWith(expect.objectContaining({ status: 'requires_action' }), false);
    expect(addToast).toHaveBeenCalledWith('info', 'Refinement Suggestion', 'Need confirmation');
    expect(result).toBe(reviewedToolResult);
  });

  it('handles accepted primary review by syncing the completed job and running post-success hooks', async () => {
    const resolvePrimaryReview = vi.fn().mockResolvedValue(undefined);
    const runMemoryExtraction = vi.fn().mockResolvedValue(undefined);
    const playSuccessSound = vi.fn();
    const useAsReference = vi.fn();
    const reviewedToolResult = createToolResult();
    const asset = createAsset();

    const result = await resolvePrimaryReviewOutcome({
      mode: AppMode.VIDEO,
      completedJob: createJob({ status: 'completed' }),
      reviewedToolResult,
      reviewSummary: 'Approved',
      continuousMode: true,
      asset,
      deps: {
        resolvePrimaryReview,
        addToast: vi.fn(),
        runMemoryExtraction,
        playSuccessSound,
        useAsReference
      }
    });

    expect(resolvePrimaryReview).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }), true);
    expect(runMemoryExtraction).not.toHaveBeenCalled();
    expect(playSuccessSound).toHaveBeenCalledTimes(1);
    expect(useAsReference).toHaveBeenCalledWith(asset, false);
    expect(result).toBe(reviewedToolResult);
  });

  it('handles auto revision requires_action by syncing the resolved job and showing a suggestion toast', async () => {
    const resolveAutoRevision = vi.fn().mockResolvedValue(undefined);
    const addToast = vi.fn();
    const revisedToolResult = createToolResult({ status: 'requires_action' });

    const result = await resolveAutoRevisionOutcome({
      mode: AppMode.IMAGE,
      resolution: 'requires_action',
      resolvedJob: createJob({ status: 'requires_action' }),
      revisedToolResult,
      reviewSummary: 'Need another decision',
      deps: {
        resolveAutoRevision,
        addToast,
        runMemoryExtraction: vi.fn(),
        playSuccessSound: vi.fn(),
        useAsReference: vi.fn()
      }
    });

    expect(resolveAutoRevision).toHaveBeenCalledWith(expect.objectContaining({ status: 'requires_action' }), false);
    expect(addToast).toHaveBeenCalledWith('info', 'Refinement Suggestion', 'Need another decision');
    expect(result).toBe(revisedToolResult);
  });

  it('prepares and resolves a primary review from review payload', async () => {
    const resolvePrimaryReviewFn = vi.fn().mockResolvedValue(undefined);
    const addToast = vi.fn();
    const reviewedToolResult = createToolResult({ status: 'requires_action' });

    const result = await resolvePrimaryReview({
      mode: AppMode.IMAGE,
      job: createJob(),
      finalizedReviewStep: createStep({ status: 'requires_action' }),
      generatedArtifact: createArtifact({ id: 'generated-1', kind: 'generated_asset' }),
      reviewArtifact: createArtifact({ id: 'review-1', kind: 'review' }),
      review: {
        decision: 'requires_action',
        summary: 'Needs refinement',
        warnings: []
      },
      prompt: 'poster',
      reviewedToolResult,
      deps: {
        resolvePrimaryReview: resolvePrimaryReviewFn,
        addToast,
        runMemoryExtraction: vi.fn().mockResolvedValue(undefined),
        playSuccessSound: vi.fn(),
        useAsReference: vi.fn()
      },
      now: () => 1710000000200
    });

    expect(resolvePrimaryReviewFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'requires_action' }), false);
    expect(addToast).toHaveBeenCalledWith('info', 'Refinement Suggestion', 'Needs refinement');
    expect(result).toBe(reviewedToolResult);
  });

  it('prepares and resolves an auto revision from review payload', async () => {
    const resolveAutoRevisionFn = vi.fn().mockResolvedValue(undefined);
    const addToast = vi.fn();
    const revisedToolResult = createToolResult({ status: 'requires_action', metadata: { revisedPrompt: 'refined' } });

    const result = await resolveAutoRevision({
      mode: AppMode.IMAGE,
      job: createJob(),
      stepsAfterRevision: [],
      finalizedRevisedGenerationStep: createStep({ id: 'gen-step-2', kind: 'generation' }),
      finalizedSecondReviewStep: createStep({ id: 'review-step-2', status: 'requires_action' }),
      generatedArtifact: createArtifact({ id: 'generated-1', kind: 'generated_asset' }),
      reviewArtifact: createArtifact({ id: 'review-1', kind: 'review' }),
      revisionArtifact: createArtifact({ id: 'revision-1', kind: 'revision' }),
      revisedGeneratedArtifact: createArtifact({ id: 'generated-2', kind: 'generated_asset' }),
      secondReviewArtifact: createArtifact({ id: 'review-2', kind: 'review' }),
      secondReview: {
        decision: 'requires_action',
        summary: 'revise again',
        warnings: []
      },
      revisedPrompt: 'refined',
      revisedAssetId: 'asset-2',
      revisedToolResult,
      deps: {
        resolveAutoRevision: resolveAutoRevisionFn,
        addToast,
        runMemoryExtraction: vi.fn().mockResolvedValue(undefined),
        playSuccessSound: vi.fn(),
        useAsReference: vi.fn()
      },
      now: () => 1710000000200
    });

    expect(resolveAutoRevisionFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'requires_action' }), false);
    expect(addToast).toHaveBeenCalledWith('info', 'Refinement Suggestion', 'revise again');
    expect(result).toBe(revisedToolResult);
  });
});
