import { describe, expect, it, vi } from 'vitest';
import {
  AppMode,
  AspectRatio,
  ImageModel,
  ImageResolution,
  ImageStyle,
  VideoDuration,
  VideoModel,
  VideoResolution,
  VideoStyle,
  type AgentJob,
  type AgentToolResult,
  type AssetItem,
  type GenerationParams,
  type JobArtifact,
  type JobStep
} from '../types';
import { executeAutoRevisionFlow } from '../services/generationAutoRevisionRuntime';

const createJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'reviewing',
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

const createToolResult = (overrides: Partial<AgentToolResult> = {}): AgentToolResult => ({
  toolName: 'generate_image',
  status: 'success',
  summary: 'done',
  artifactIds: ['asset-1'],
  ...overrides
});

const createArtifact = (overrides: Partial<JobArtifact> = {}): JobArtifact => ({
  id: 'artifact-1',
  kind: 'generated_asset',
  label: 'Generated',
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

describe('generationAutoRevisionRuntime', () => {
  it('coordinates auto revision execution, second review, and resolution', async () => {
    const startAutoRevision = vi.fn().mockResolvedValue(undefined);
    const playVisibleSuccess = vi.fn();
    const executeAttempt = vi.fn().mockResolvedValue({
      revisedAsset: {
        id: 'asset-2',
        projectId: 'project-1',
        type: 'IMAGE',
        url: 'blob://revised',
        prompt: 'refined poster',
        createdAt: 1710000000000,
        status: 'COMPLETED',
        jobId: 'job-1'
      } as AssetItem,
      finalizedRevisedGenerationStep: createStep({ id: 'step-2', kind: 'generation' }),
      revisedGeneratedArtifact: createArtifact({ id: 'artifact-2' }),
      secondReviewStep: createStep({ id: 'step-3', status: 'running' }),
      reviewingRevisionJob: createJob({ status: 'reviewing', currentStepId: 'step-3' })
    });
    const executeReview = vi.fn().mockResolvedValue({
      secondReview: {
        decision: 'requires_action',
        summary: 'revise again',
        warnings: []
      },
      secondReviewArtifact: createArtifact({ id: 'artifact-3', kind: 'review' }),
      finalizedSecondReviewStep: createStep({ id: 'step-3', status: 'failed' }),
      revisedToolResult: createToolResult({ status: 'requires_action' })
    });
    const resolveAutoRevision = vi.fn().mockResolvedValue(createToolResult({ status: 'requires_action' }));

    const result = await executeAutoRevisionFlow({
      job: createJob(),
      review: {
        decision: 'auto_revise',
        summary: 'improve anatomy',
        warnings: [],
        revisionReason: 'improve anatomy'
      },
      currentMode: AppMode.IMAGE,
      originalPrompt: 'poster',
      genParams: createParams(),
      toolCall: undefined,
      finalizedReviewStep: createStep(),
      reviewArtifact: createArtifact({ id: 'review-1', kind: 'review' }),
      generatedArtifact: createArtifact({ id: 'generated-1' }),
      currentProjectId: 'project-1',
      signal: new AbortController().signal,
      taskId: 'task-1',
      jobId: 'job-1',
      toolResult: createToolResult(),
      selectedReferences: [{ id: 'ref-1' }],
      historyForGeneration: [],
      continuousMode: true,
      taskRuntime: {
        startAutoRevision
      },
      deps: {
        executeAttempt,
        executeReview,
        resolveAutoRevision,
        playVisibleSuccess,
        normalizeAssistantMode: value => value as any,
        now: () => 1710000000200,
        createId: vi.fn()
          .mockReturnValueOnce('revision-step-1')
          .mockReturnValueOnce('revision-artifact-1')
          .mockReturnValueOnce('revised-generation-step-1')
          .mockReturnValueOnce('second-review-step-1')
      }
    });

    expect(startAutoRevision).toHaveBeenCalledTimes(1);
    expect(executeAttempt).toHaveBeenCalledTimes(1);
    expect(executeReview).toHaveBeenCalledWith(expect.objectContaining({
      revisedPrompt: expect.any(String),
      revisedAsset: expect.objectContaining({ id: 'asset-2' })
    }));
    expect(playVisibleSuccess).toHaveBeenCalledTimes(1);
    expect(resolveAutoRevision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'requires_action' });
  });
});
