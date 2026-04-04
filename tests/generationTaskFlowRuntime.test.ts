import { describe, expect, it, vi } from 'vitest';
import { AppMode, AspectRatio, ImageModel, ImageResolution, ImageStyle, VideoDuration, VideoModel, VideoResolution, VideoStyle, type AgentJob, type AgentToolResult, type AssetItem, type GenerationParams } from '../types';
import { executePreparedGenerationTask } from '../services/generationTaskFlowRuntime';

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

const createToolResult = (overrides: Partial<AgentToolResult> = {}): AgentToolResult => ({
  toolName: 'generate_image',
  status: 'success',
  summary: 'done',
  artifactIds: ['asset-1'],
  ...overrides
});

describe('generationTaskFlowRuntime', () => {
  it('routes accepted review to primary review resolution', async () => {
    const resolvePrimaryReview = vi.fn().mockResolvedValue({
      ...createToolResult({ status: 'success' }),
      metadata: { runtimeEvents: [{ type: 'ReviewCompleted' }, { type: 'JobCompleted' }] }
    });
    const result = await executePreparedGenerationTask({
      mode: AppMode.IMAGE,
      agentJob: createJob(),
      stepId: 'step-1',
      taskId: 'task-1',
      jobId: 'job-1',
      currentProjectId: 'project-1',
      activeParams: createParams(),
      initialPendingAsset: createAsset({ id: 'task-1', status: 'PENDING', url: '' }),
      signal: new AbortController().signal,
      selectedReferenceRecords: [],
      deps: {
        stagePendingAsset: vi.fn().mockResolvedValue(undefined),
        normalizeGenerationParams: vi.fn().mockReturnValue(createParams()),
        executeGenerationAttempt: vi.fn().mockResolvedValue({
          asset: createAsset(),
          toolResult: createToolResult(),
          runtimeEvents: [{ type: 'AssetProduced' }]
        }),
        afterVisibleImage: vi.fn().mockResolvedValue(undefined),
        executePrimaryReview: vi.fn().mockResolvedValue({
          generatedArtifact: { id: 'artifact-1', kind: 'generated_asset' },
          review: { decision: 'accept', summary: 'good', warnings: [] },
          reviewArtifact: { id: 'artifact-2', kind: 'review' },
          finalizedReviewStep: { id: 'review-step-1', kind: 'review', name: 'review_output', status: 'success', startTime: 1, endTime: 2, input: {}, output: {} },
          reviewedToolResult: createToolResult(),
          runtimeEvents: [{ type: 'ReviewStarted' }]
        }),
        executeAutoRevisionFlow: vi.fn(),
        resolvePrimaryReview,
        resolveGenerationFailure: vi.fn()
      }
    });

    expect(resolvePrimaryReview).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.metadata?.runtimeEvents).toMatchObject([
      { type: 'AssetProduced' },
      { type: 'ReviewStarted' },
      { type: 'ReviewCompleted' },
      { type: 'JobCompleted' }
    ]);
  });

  it('routes auto revise review to auto revision flow', async () => {
    const executeAutoRevisionFlow = vi.fn().mockResolvedValue({
      ...createToolResult({ status: 'requires_action' }),
      metadata: { runtimeEvents: [{ type: 'ReviewCompleted' }, { type: 'RequiresActionRaised' }] }
    });
    const result = await executePreparedGenerationTask({
      mode: AppMode.IMAGE,
      agentJob: createJob(),
      stepId: 'step-1',
      taskId: 'task-1',
      jobId: 'job-1',
      currentProjectId: 'project-1',
      activeParams: createParams(),
      initialPendingAsset: createAsset({ id: 'task-1', status: 'PENDING', url: '' }),
      signal: new AbortController().signal,
      selectedReferenceRecords: [],
      deps: {
        stagePendingAsset: vi.fn().mockResolvedValue(undefined),
        normalizeGenerationParams: vi.fn().mockReturnValue(createParams()),
        executeGenerationAttempt: vi.fn().mockResolvedValue({
          asset: createAsset(),
          toolResult: createToolResult(),
          runtimeEvents: [{ type: 'AssetProduced' }]
        }),
        afterVisibleImage: vi.fn().mockResolvedValue(undefined),
        executePrimaryReview: vi.fn().mockResolvedValue({
          generatedArtifact: { id: 'artifact-1', kind: 'generated_asset' },
          review: { decision: 'auto_revise', summary: 'fix anatomy', warnings: [], revisionReason: 'fix anatomy' },
          reviewArtifact: { id: 'artifact-2', kind: 'review' },
          finalizedReviewStep: { id: 'review-step-1', kind: 'review', name: 'review_output', status: 'success', startTime: 1, endTime: 2, input: {}, output: {} },
          reviewedToolResult: createToolResult(),
          runtimeEvents: [{ type: 'ReviewStarted' }]
        }),
        executeAutoRevisionFlow,
        resolvePrimaryReview: vi.fn(),
        resolveGenerationFailure: vi.fn()
      }
    });

    expect(executeAutoRevisionFlow).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('requires_action');
    expect(result.metadata?.runtimeEvents).toMatchObject([
      { type: 'AssetProduced' },
      { type: 'ReviewStarted' },
      { type: 'ReviewCompleted' },
      { type: 'RequiresActionRaised' }
    ]);
  });

  it('routes thrown errors to generation failure runtime', async () => {
    const resolveGenerationFailure = vi.fn().mockResolvedValue({
      toolResult: {
        ...createToolResult({ status: 'error' }),
        metadata: {
          runtimeEvents: [{ type: 'JobFailed' }]
        }
      },
      taskMarkedVisibleComplete: false
    });
    const result = await executePreparedGenerationTask({
      mode: AppMode.IMAGE,
      agentJob: createJob(),
      stepId: 'step-1',
      taskId: 'task-1',
      jobId: 'job-1',
      currentProjectId: 'project-1',
      activeParams: createParams(),
      initialPendingAsset: createAsset({ id: 'task-1', status: 'PENDING', url: '' }),
      signal: new AbortController().signal,
      selectedReferenceRecords: [],
      deps: {
        stagePendingAsset: vi.fn().mockResolvedValue(undefined),
        normalizeGenerationParams: vi.fn().mockReturnValue(createParams()),
        executeGenerationAttempt: vi.fn().mockRejectedValue(new Error('boom')),
        afterVisibleImage: vi.fn().mockResolvedValue(undefined),
        executePrimaryReview: vi.fn(),
        executeAutoRevisionFlow: vi.fn(),
        resolvePrimaryReview: vi.fn(),
        resolveGenerationFailure
      }
    });

    expect(resolveGenerationFailure).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('error');
    expect(result.metadata?.runtimeEvents).toMatchObject([{ type: 'JobFailed' }]);
  });
});
