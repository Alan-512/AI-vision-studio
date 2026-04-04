import { describe, expect, it, vi } from 'vitest';
import { createAppGenerationTaskFlowDepsBuilder } from '../services/appGenerationTaskFlowDepsRuntime';

describe('appGenerationTaskFlowDepsRuntime', () => {
  it('delegates normalizeGenerationParams to the app-level normalizer', () => {
    const normalizeGenerationParamsForExecution = vi.fn().mockReturnValue({ prompt: 'normalized' });
    const builder = createAppGenerationTaskFlowDepsBuilder({
      currentMode: 'IMAGE',
      normalizeGenerationParamsForExecution,
      translateTag: (key: string) => key,
      executeGenerationAttempt: vi.fn(),
      executePrimaryReview: vi.fn(),
      executeAutoRevisionFlow: vi.fn(),
      resolvePrimaryReview: vi.fn(),
      resolveGenerationFailure: vi.fn(),
      generateImageImpl: vi.fn(),
      generateVideoImpl: vi.fn(),
      normalizeAssistantMode: vi.fn(value => value),
      buildImageCriticContext: vi.fn(),
      reviewGeneratedAsset: vi.fn(),
      buildDefaultRefinePromptRequiresAction: vi.fn(),
      chatHistory: [],
      runMemoryExtractionTask: vi.fn(),
      addToast: vi.fn(),
      handleUseAsReference: vi.fn(),
      playSuccessSound: vi.fn(),
      playErrorSound: vi.fn(),
      setVideoCooldownEndTime: vi.fn(),
      getFriendlyError: vi.fn(),
      language: 'zh'
    });

    const deps = builder({
      taskRuntime: { stagePendingAsset: vi.fn() },
      getAgentJob: vi.fn(),
      stepId: 'step-1',
      taskId: 'task-1',
      jobId: 'job-1',
      currentProjectId: 'project-1',
      activeParams: { prompt: 'runtime prompt' },
      initialPendingAsset: { id: 'asset-1' },
      signal: new AbortController().signal,
      selectedReferenceRecords: [],
      historyForGeneration: [],
      latestVisibleAssetRef: { current: null },
      taskMarkedVisibleCompleteRef: { current: false },
      playVisibleSuccess: vi.fn()
    });

    expect(deps.normalizeGenerationParams()).toEqual({ prompt: 'normalized' });
    expect(normalizeGenerationParamsForExecution).toHaveBeenCalled();
  });

  it('marks visible completion only once', async () => {
    const markTaskVisibleComplete = vi.fn().mockResolvedValue(undefined);
    const latestVisibleAssetRef = { current: null as any };
    const taskMarkedVisibleCompleteRef = { current: false };
    const playVisibleSuccess = vi.fn();
    const builder = createAppGenerationTaskFlowDepsBuilder({
      currentMode: 'IMAGE',
      normalizeGenerationParamsForExecution: vi.fn(),
      translateTag: (key: string) => key,
      executeGenerationAttempt: vi.fn(),
      executePrimaryReview: vi.fn(),
      executeAutoRevisionFlow: vi.fn(),
      resolvePrimaryReview: vi.fn(),
      resolveGenerationFailure: vi.fn(),
      generateImageImpl: vi.fn(),
      generateVideoImpl: vi.fn(),
      normalizeAssistantMode: vi.fn(value => value),
      buildImageCriticContext: vi.fn(),
      reviewGeneratedAsset: vi.fn(),
      buildDefaultRefinePromptRequiresAction: vi.fn(),
      chatHistory: [],
      runMemoryExtractionTask: vi.fn(),
      addToast: vi.fn(),
      handleUseAsReference: vi.fn(),
      playSuccessSound: vi.fn(),
      playErrorSound: vi.fn(),
      setVideoCooldownEndTime: vi.fn(),
      getFriendlyError: vi.fn(),
      language: 'zh'
    });

    const deps = builder({
      taskRuntime: { stagePendingAsset: vi.fn(), markTaskVisibleComplete },
      getAgentJob: () => ({ id: 'job-1' }),
      stepId: 'step-1',
      taskId: 'task-1',
      jobId: 'job-1',
      currentProjectId: 'project-1',
      activeParams: { prompt: 'runtime prompt' },
      initialPendingAsset: { id: 'asset-1' },
      signal: new AbortController().signal,
      selectedReferenceRecords: [],
      historyForGeneration: [],
      latestVisibleAssetRef,
      taskMarkedVisibleCompleteRef,
      playVisibleSuccess
    });

    await deps.afterVisibleImage({
      asset: { id: 'asset-1' },
      taskRuntime: { markTaskVisibleComplete },
      taskContext: { signal: new AbortController().signal, getAgentJob: () => ({ id: 'job-1' }) }
    });
    await deps.afterVisibleImage({
      asset: { id: 'asset-2' },
      taskRuntime: { markTaskVisibleComplete },
      taskContext: { signal: new AbortController().signal, getAgentJob: () => ({ id: 'job-1' }) }
    });

    expect(latestVisibleAssetRef.current).toEqual({ id: 'asset-2' });
    expect(playVisibleSuccess).toHaveBeenCalledTimes(2);
    expect(markTaskVisibleComplete).toHaveBeenCalledTimes(1);
  });

  it('routes auto revision resolution through the dedicated resolver', async () => {
    const resolveAutoRevision = vi.fn().mockResolvedValue({ status: 'requires_action' });
    const resolvePrimaryReview = vi.fn().mockResolvedValue({ status: 'completed' });
    const executeAutoRevisionFlow = vi.fn(async ({ deps }: any) => deps.resolveAutoRevision({
      mode: 'IMAGE',
      job: { id: 'job-1' },
      stepsAfterRevision: [],
      finalizedRevisedGenerationStep: { id: 'gen-step-2' },
      finalizedSecondReviewStep: { id: 'review-step-2' },
      generatedArtifact: { id: 'generated-1' },
      reviewArtifact: { id: 'review-1' },
      revisionArtifact: { id: 'revision-1' },
      revisedGeneratedArtifact: { id: 'generated-2' },
      secondReviewArtifact: { id: 'review-2' },
      secondReview: { decision: 'requires_action', summary: 'revise again', warnings: [] },
      revisedPrompt: 'refined',
      revisedAssetId: 'asset-2',
      revisedToolResult: { toolName: 'generate_image', status: 'requires_action' },
      revisedAsset: { id: 'asset-2' }
    }));
    const builder = createAppGenerationTaskFlowDepsBuilder({
      currentMode: 'IMAGE',
      normalizeGenerationParamsForExecution: vi.fn(),
      translateTag: (key: string) => key,
      executeGenerationAttempt: vi.fn(),
      executePrimaryReview: vi.fn(),
      executeAutoRevisionFlow,
      resolvePrimaryReview,
      resolveAutoRevision,
      resolveGenerationFailure: vi.fn(),
      generateImageImpl: vi.fn(),
      generateVideoImpl: vi.fn(),
      normalizeAssistantMode: vi.fn(value => value),
      buildImageCriticContext: vi.fn(),
      reviewGeneratedAsset: vi.fn(),
      buildDefaultRefinePromptRequiresAction: vi.fn(),
      chatHistory: [],
      runMemoryExtractionTask: vi.fn(),
      addToast: vi.fn(),
      handleUseAsReference: vi.fn(),
      playSuccessSound: vi.fn(),
      playErrorSound: vi.fn(),
      setVideoCooldownEndTime: vi.fn(),
      getFriendlyError: vi.fn(),
      language: 'zh'
    });

    const deps = builder({
      taskRuntime: {
        resolveAutoRevision: vi.fn().mockResolvedValue(undefined)
      },
      getAgentJob: () => ({ id: 'job-1' }),
      stepId: 'step-1',
      taskId: 'task-1',
      jobId: 'job-1',
      currentProjectId: 'project-1',
      activeParams: { prompt: 'runtime prompt', continuousMode: false },
      initialPendingAsset: { id: 'asset-1' },
      signal: new AbortController().signal,
      selectedReferenceRecords: [],
      historyForGeneration: [],
      latestVisibleAssetRef: { current: null },
      taskMarkedVisibleCompleteRef: { current: false },
      playVisibleSuccess: vi.fn()
    });

    await deps.executeAutoRevisionFlow({
      review: { summary: 'revise', decision: 'auto_revise' },
      genParams: { prompt: 'poster' },
      toolResult: { toolName: 'generate_image', status: 'success' },
      generatedArtifact: { id: 'artifact-1' },
      reviewArtifact: { id: 'artifact-2' },
      finalizedReviewStep: { id: 'step-r' },
      selectedReferenceRecords: [],
      taskRuntime: { startAutoRevision: vi.fn() },
      taskContext: {
        getAgentJob: () => ({ id: 'job-1' }),
        currentProjectId: 'project-1',
        signal: new AbortController().signal,
        taskId: 'task-1',
        jobId: 'job-1',
        historyForGeneration: [],
        activeParams: { continuousMode: false }
      }
    });

    expect(resolveAutoRevision).toHaveBeenCalledTimes(1);
    expect(resolvePrimaryReview).not.toHaveBeenCalled();
  });
});
