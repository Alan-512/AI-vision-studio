import { describe, expect, it, vi } from 'vitest';
import { createGenerationTaskLaunchController } from '../services/generationTaskLaunchController';

describe('generationTaskLaunchController', () => {
  it('composes launcher, session runtime, task runtime, and flow runtime into one launch entry', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const saveAsset = vi.fn().mockResolvedValue(undefined);
    const updateAsset = vi.fn().mockResolvedValue(undefined);
    const deleteAssetPermanently = vi.fn().mockResolvedValue(undefined);
    const executePrepared = vi.fn().mockResolvedValue({ status: 'success' });

    const launch = createGenerationTaskLaunchController({
      persistenceDeps: {
        taskViewsRef: { current: [] },
        setTaskViews: vi.fn(),
        saveTaskView,
        deleteTaskView,
        activeProjectIdRef: { current: 'project-1' },
        setAssets: vi.fn(),
        saveAsset,
        updateAsset,
        deleteAssetPermanently,
        saveAgentJobSnapshot,
        onPreview: vi.fn(),
        onSuccess: vi.fn()
      },
      launcherDeps: {
        loadExistingJob: vi.fn().mockResolvedValue(undefined),
        getPreviousTaskIds: vi.fn().mockReturnValue([]),
        createAbortController: () => new AbortController(),
        registerController: vi.fn(),
        unregisterController: vi.fn()
      },
      runtimeDeps: {
        now: () => 123,
        createId: vi.fn()
          .mockReturnValueOnce('task-1')
          .mockReturnValueOnce('step-1'),
        executePreparedGenerationTask: executePrepared
      }
    });

    const result = await launch({
      currentProjectId: 'project-1',
      currentMode: 'IMAGE' as any,
      activeParams: { prompt: 'test prompt' } as any,
      resolvedJobSource: 'studio',
      selectedReferenceRecords: [],
      createSessionInput: {
        projectName: 'Project',
        createResumeActionStep: vi.fn(),
        buildConsistencyProfile: vi.fn().mockReturnValue(undefined),
        normalizeAssistantMode: vi.fn(value => value),
        prepareGenerationLaunch: vi.fn().mockReturnValue({
          pendingAsset: { id: 'task-1' },
          queuedJob: { id: 'task-1', steps: [] }
        })
      },
      buildTaskRuntimeDeps: () => ({
        stagePendingAsset: vi.fn(),
        normalizeGenerationParams: vi.fn(),
        executeGenerationAttempt: vi.fn(),
        afterVisibleImage: vi.fn(),
        executePrimaryReview: vi.fn(),
        executeAutoRevisionFlow: vi.fn(),
        resolvePrimaryReview: vi.fn(),
        resolveGenerationFailure: vi.fn()
      })
    });

    expect(result).toEqual({ status: 'success' });
    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(1);
    expect(executePrepared).toHaveBeenCalledTimes(1);
  });
});
