import { describe, expect, it, vi } from 'vitest';
import { AppMode, AspectRatio, ImageModel, ImageResolution, ImageStyle, VideoDuration, VideoModel, VideoResolution, VideoStyle, type AgentJob, type AssetItem, type GenerationParams, type JobStep } from '../types';
import { executeAutoRevisionReview, executePrimaryReview } from '../services/generationReviewRuntime';

const createJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'executing',
  createdAt: 1710000000000,
  updatedAt: 1710000000001,
  source: 'studio',
  steps: [{
    id: 'step-1',
    kind: 'generation',
    name: 'generate_image',
    status: 'success',
    startTime: 1710000000000,
    endTime: 1710000000010,
    input: { prompt: 'poster' },
    output: { assetId: 'asset-1' }
  }],
  artifacts: [],
  ...overrides
});

const createAsset = (overrides: Partial<AssetItem> = {}): AssetItem => ({
  id: 'asset-1',
  projectId: 'project-1',
  type: 'IMAGE',
  url: 'blob://image',
  prompt: 'poster',
  createdAt: 1710000000000,
  status: 'COMPLETED',
  ...overrides
});

const createParams = (): GenerationParams => ({
  prompt: 'poster',
  savedImagePrompt: '',
  savedVideoPrompt: '',
  aspectRatio: AspectRatio.SQUARE,
  imageModel: ImageModel.FLASH_3_1,
  videoModel: VideoModel.VEO_FAST,
  imageStyle: ImageStyle.NONE,
  videoStyle: VideoStyle.NONE,
  imageResolution: ImageResolution.RES_1K,
  videoResolution: VideoResolution.RES_720P,
  videoDuration: VideoDuration.SHORT,
  useGrounding: false,
  smartAssets: []
});

describe('generationReviewRuntime', () => {
  it('awaits review start persistence before returning primary review events', async () => {
    let resolveStartReview: ((value: { events: { type: string }[] }) => void) | null = null;
    const startReview = vi.fn().mockImplementation(
      () => new Promise(resolve => {
        resolveStartReview = resolve;
      })
    );
    const reviewAsset = vi.fn().mockResolvedValue({
      decision: 'accept',
      summary: 'looks good',
      warnings: []
    });

    const promise = executePrimaryReview({
      job: createJob(),
      asset: createAsset(),
      generationStepId: 'step-1',
      toolResult: {
        toolName: 'generate_image',
        status: 'success',
        summary: 'done',
        artifactIds: ['asset-1']
      },
      prompt: 'poster',
      genParams: createParams(),
      selectedReferences: [],
      assistantMode: 'EDIT_LAST',
      taskRuntime: { startReview },
      buildCriticContext: vi.fn().mockReturnValue({ hardConstraints: [] }),
      reviewAsset,
      now: () => 1710000000200,
      createId: vi.fn().mockReturnValueOnce('review-step-1').mockReturnValueOnce('review-artifact-1')
    });

    resolveStartReview?.({ events: [{ type: 'ReviewStarted' }] });

    const result = await promise;
    expect(result.runtimeEvents).toMatchObject([{ type: 'ReviewStarted' }]);
  });

  it('executes primary review and returns finalized review artifacts', async () => {
    const startReview = vi.fn().mockResolvedValue({ events: [{ type: 'ReviewStarted' }] });
    const buildCriticContext = vi.fn().mockReturnValue({ hardConstraints: [] });
    const reviewAsset = vi.fn().mockResolvedValue({
      decision: 'accept',
      summary: 'looks good',
      warnings: []
    });

    const result = await executePrimaryReview({
      job: createJob(),
      asset: createAsset(),
      generationStepId: 'step-1',
      toolResult: {
        toolName: 'generate_image',
        status: 'success',
        summary: 'done',
        artifactIds: ['asset-1']
      },
      prompt: 'poster',
      genParams: createParams(),
      selectedReferences: [{ id: 'ref-1' }],
      assistantMode: 'EDIT_LAST',
      taskRuntime: { startReview },
      buildCriticContext,
      reviewAsset,
      now: () => 1710000000200,
      createId: vi.fn().mockReturnValueOnce('review-step-1').mockReturnValueOnce('review-artifact-1')
    });

    expect(startReview).toHaveBeenCalledWith(expect.objectContaining({
      status: 'reviewing',
      currentStepId: 'review-step-1'
    }), false);
    expect(buildCriticContext).toHaveBeenCalledWith(expect.objectContaining({
      assistantMode: 'EDIT_LAST',
      selectedReferences: [{ id: 'ref-1' }]
    }));
    expect(reviewAsset).toHaveBeenCalledWith(expect.objectContaining({ id: 'asset-1' }), 'poster', expect.any(Object));
    expect(result.reviewArtifact.id).toBe('review-artifact-1');
    expect(result.finalizedReviewStep.status).toBe('success');
    expect(result.reviewedToolResult.status).toBe('success');
    expect(result.runtimeEvents).toMatchObject([{ type: 'ReviewStarted' }]);
  });

  it('executes auto revision review and builds revised tool result', async () => {
    const reviewAsset = vi.fn().mockResolvedValue({
      decision: 'requires_action',
      summary: 'refine again',
      warnings: [],
      requiresAction: undefined
    });
    const revisedGenerationStep: JobStep = {
      id: 'step-2',
      kind: 'generation',
      name: 'generate_image',
      status: 'success',
      startTime: 1710000000000,
      endTime: 1710000000100,
      input: { prompt: 'revised poster' },
      output: { assetId: 'asset-2' }
    };

    const result = await executeAutoRevisionReview({
      revisedAsset: createAsset({ id: 'asset-2', prompt: 'revised poster' }),
      revisedPrompt: 'revised poster',
      revisedParams: createParams(),
      assistantMode: 'EDIT_LAST',
      selectedReferences: [{ id: 'ref-1' }],
      job: createJob(),
      secondReviewStep: {
        id: 'review-step-2',
        kind: 'review',
        name: 'review_output',
        status: 'running',
        startTime: 1710000000000,
        input: {}
      },
      toolResult: {
        toolName: 'generate_image',
        status: 'success',
        summary: 'done',
        artifactIds: ['asset-2']
      },
      revisionStepId: 'revision-step-1',
      reviewSummary: 'improve anatomy',
      taskRuntime: {
        buildCriticContext: vi.fn().mockReturnValue({ hardConstraints: [] }),
        reviewAsset,
        buildDefaultRequiresAction: vi.fn().mockReturnValue({
          type: 'refine_prompt',
          message: 'continue',
          payload: {}
        })
      },
      now: () => 1710000000200,
      createId: vi.fn().mockReturnValue('review-artifact-2')
    });

    expect(reviewAsset).toHaveBeenCalledWith(expect.objectContaining({ id: 'asset-2' }), 'revised poster', expect.any(Object));
    expect(result.secondReviewArtifact.id).toBe('review-artifact-2');
    expect(result.finalizedSecondReviewStep.status).toBe('failed');
    expect(result.revisedToolResult.status).toBe('requires_action');
    expect(result.revisedToolResult.metadata?.revisedPrompt).toBe('revised poster');
    expect(result.runtimeEvents).toEqual([]);
  });
});
