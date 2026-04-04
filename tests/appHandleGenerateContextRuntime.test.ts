import { describe, expect, it, vi } from 'vitest';
import { createAppHandleGenerateContextBuilder } from '../services/appHandleGenerateContextRuntime';

describe('appHandleGenerateContextRuntime', () => {
  it('builds launch and session context for app handle-generate flow', () => {
    const dispatchKernelCommand = vi.fn();
    const loadAgentJobsByProject = vi.fn();
    const builder = createAppHandleGenerateContextBuilder({
      tasksRef: { current: [{ id: 'task-1', jobId: 'job-1' }] },
      setTaskViews: vi.fn(),
      saveTaskView: vi.fn(),
      deleteTaskView: vi.fn(),
      activeProjectIdRef: { current: 'project-1' },
      setAssets: vi.fn(),
      saveAsset: vi.fn(),
      updateAsset: vi.fn(),
      deleteAssetPermanently: vi.fn(),
      saveAgentJobSnapshot: vi.fn(),
      loadAgentJobsByProject,
      taskControllers: { current: {} },
      createGenerationTaskLaunchController: vi.fn(),
      executeAppGenerationRequest: vi.fn(),
      dispatchKernelCommand,
      createResumeActionStep: vi.fn(),
      buildConsistencyProfile: vi.fn(),
      normalizeAssistantMode: vi.fn(),
      prepareGenerationLaunch: vi.fn(),
      playSuccessSound: vi.fn()
    });

    const context = builder({
      onPreview: vi.fn(),
      onSuccess: vi.fn()
    });

    expect(context.launchControllerInput.persistenceDeps).toMatchObject({
      activeProjectIdRef: { current: 'project-1' }
    });
    expect(typeof context.launchControllerInput.launcherDeps.loadExistingJob).toBe('function');
    expect(typeof context.launchControllerInput.launcherDeps.registerController).toBe('function');
    expect(typeof context.launchControllerInput.runtimeDeps.now).toBe('function');
    expect(context.createSessionInput).toMatchObject({
      createResumeActionStep: expect.any(Function),
      buildConsistencyProfile: expect.any(Function),
      normalizeAssistantMode: expect.any(Function),
      prepareGenerationLaunch: expect.any(Function)
    });
    context.dispatchKernelCommand?.({ type: 'StartGeneration', payload: { kind: 'generation_request', input: { launchControllerInput: {}, requestInput: {} } } } as any);
    expect(dispatchKernelCommand).toHaveBeenCalled();
  });
});
