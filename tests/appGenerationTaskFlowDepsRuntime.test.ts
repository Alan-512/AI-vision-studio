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
});
