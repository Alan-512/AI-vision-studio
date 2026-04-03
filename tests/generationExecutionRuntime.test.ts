import { describe, expect, it, vi } from 'vitest';
import { AppMode, AspectRatio, ImageModel, ImageResolution, ImageStyle, VideoDuration, VideoModel, VideoResolution, VideoStyle, type AgentJob, type AssetItem, type GenerationParams, type JobStep, type AgentToolResult } from '../types';
import { executeAutoRevisionAttempt, executeGenerationAttempt } from '../services/generationExecutionRuntime';

const createParams = (): GenerationParams => ({
  prompt: 'cinematic poster',
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

const createExecutingJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  ...createJob({
    status: 'executing',
    currentStepId: 'step-1',
    steps: [{
      id: 'step-1',
      kind: 'generation',
      name: 'generate_image',
      status: 'running',
      startTime: 1710000000000,
      input: { prompt: 'cinematic poster' }
    }]
  }),
  ...overrides
});

const createPendingAsset = (): AssetItem => ({
  id: 'task-1',
  projectId: 'project-1',
  type: 'IMAGE',
  url: '',
  prompt: 'cinematic poster',
  createdAt: 1710000000000,
  status: 'PENDING'
});

const createToolResult = (): AgentToolResult => ({
  toolName: 'generate_image',
  status: 'success',
  summary: 'Image generation completed',
  metadata: {},
  artifactIds: ['asset-1']
});

describe('generationExecutionRuntime', () => {
  it('runs an image generation attempt through the task runtime', async () => {
    const stageRunningJob = vi.fn().mockResolvedValue(undefined);
    const completeVisibleImage = vi.fn().mockResolvedValue(undefined);
    const asset: AssetItem = {
      id: 'asset-1',
      projectId: 'project-1',
      type: 'IMAGE',
      url: 'blob://image',
      prompt: 'cinematic poster',
      createdAt: 1710000000000,
      status: 'COMPLETED',
      metadata: {
        model: ImageModel.FLASH_3_1,
        aspectRatio: AspectRatio.SQUARE
      }
    };

    const result = await executeGenerationAttempt({
      mode: AppMode.IMAGE,
      agentJob: createExecutingJob(),
      stepId: 'step-1',
      taskId: 'task-1',
      jobId: 'job-1',
      currentProjectId: 'project-1',
      genParams: createParams(),
      initialPendingAsset: createPendingAsset(),
      signal: new AbortController().signal,
      taskRuntime: {
        stageRunningJob,
        completeVisibleImage,
        updateOperation: vi.fn(),
        completeVideo: vi.fn()
      },
      generateImageImpl: async (_params, _projectId, onStart) => {
        onStart();
        return asset;
      },
      generateVideoImpl: vi.fn(),
      now: () => 1710000000100
    });

    expect(stageRunningJob).toHaveBeenCalledTimes(1);
    expect(completeVisibleImage).toHaveBeenCalledWith({
      asset: expect.objectContaining({ id: 'asset-1', jobId: 'job-1' }),
      completedJob: expect.objectContaining({
        status: 'executing',
        steps: [
          expect.objectContaining({
            id: 'step-1',
            status: 'success'
          })
        ]
      })
    });
    expect(result.asset).toMatchObject({ id: 'asset-1', jobId: 'job-1' });
    expect(result.toolResult.toolName).toBe('generate_image');
  });

  it('runs a video generation attempt through the task runtime', async () => {
    const stageRunningJob = vi.fn().mockResolvedValue(undefined);
    const updateOperation = vi.fn().mockResolvedValue(undefined);
    const completeVideo = vi.fn().mockResolvedValue(undefined);

    const result = await executeGenerationAttempt({
      mode: AppMode.VIDEO,
      agentJob: createExecutingJob({
        type: 'VIDEO_GENERATION',
        steps: [{
          id: 'step-1',
          kind: 'generation',
          name: 'generate_video',
          status: 'running',
          startTime: 1710000000000,
          input: { prompt: 'cinematic poster' }
        }]
      }),
      stepId: 'step-1',
      taskId: 'task-1',
      jobId: 'job-1',
      currentProjectId: 'project-1',
      genParams: createParams(),
      initialPendingAsset: { ...createPendingAsset(), type: 'VIDEO' },
      signal: new AbortController().signal,
      taskRuntime: {
        stageRunningJob,
        completeVisibleImage: vi.fn(),
        updateOperation,
        completeVideo
      },
      generateImageImpl: vi.fn(),
      generateVideoImpl: async (_params, onUpdate, onStart) => {
        onStart();
        await onUpdate('operation-1');
        return {
          blobUrl: 'blob://video',
          videoUri: 'gs://video'
        };
      },
      now: () => 1710000000200
    });

    expect(stageRunningJob).toHaveBeenCalledTimes(1);
    expect(updateOperation).toHaveBeenCalledWith({
      operationJob: expect.objectContaining({ status: 'executing' }),
      assetPatch: expect.objectContaining({ operationName: 'operation-1' })
    });
    expect(completeVideo).toHaveBeenCalledWith({
      assetUpdates: expect.objectContaining({ url: 'blob://video', videoUri: 'gs://video' }),
      completedJob: expect.objectContaining({
        status: 'executing',
        steps: [
          expect.objectContaining({
            id: 'step-1',
            status: 'success'
          })
        ]
      })
    });
    expect(result.asset).toMatchObject({ type: 'VIDEO', url: 'blob://video', videoUri: 'gs://video' });
    expect(result.toolResult.toolName).toBe('generate_video');
  });

  it('runs an auto revision image attempt through publish-and-review handoff', async () => {
    const publishAssetAndPersistJob = vi.fn().mockResolvedValue(undefined);
    const revisedAsset: AssetItem = {
      id: 'asset-2',
      projectId: 'project-1',
      type: 'IMAGE',
      url: 'blob://revised-image',
      prompt: 'revised cinematic poster',
      createdAt: 1710000000000,
      status: 'COMPLETED'
    };
    const revisedGenerationStep: JobStep = {
      id: 'step-2',
      kind: 'generation',
      name: 'generate_image',
      status: 'running',
      startTime: 1710000000000,
      input: { prompt: 'revised cinematic poster' }
    };

    const result = await executeAutoRevisionAttempt({
      executingRevisionJob: createJob({
        status: 'executing',
        type: 'IMAGE_GENERATION',
        steps: [revisedGenerationStep],
        artifacts: []
      }),
      stepsAfterRevision: [],
      revisedGenerationStep,
      revisedGenerationStepId: 'step-2',
      revisedParams: createParams(),
      currentProjectId: 'project-1',
      signal: new AbortController().signal,
      taskId: 'task-1',
      jobId: 'job-1',
      parentArtifactId: 'asset-1',
      toolResult: createToolResult(),
      taskRuntime: {
        publishAssetAndPersistJob
      },
      generateImageImpl: async () => revisedAsset,
      secondReviewStepId: 'step-3',
      now: () => 1710000000300
    });

    expect(publishAssetAndPersistJob).toHaveBeenCalledWith({
      asset: expect.objectContaining({ id: 'asset-2', jobId: 'job-1' }),
      job: expect.objectContaining({
        status: 'reviewing',
        currentStepId: 'step-3'
      })
    });
    expect(result.revisedAsset).toMatchObject({ id: 'asset-2', jobId: 'job-1' });
    expect(result.secondReviewStep.id).toBe('step-3');
    expect(result.reviewingRevisionJob.status).toBe('reviewing');
  });
});
