import { describe, expect, it, vi } from 'vitest';
import { AppMode } from '../types';
import { executeAppGenerationFlow } from '../services/appGenerationRuntime';

describe('appGenerationRuntime', () => {
  it('creates the launch controller and executes the prepared app request', async () => {
    const launchPreparedTask = vi.fn();
    const createGenerationTaskLaunchController = vi.fn().mockReturnValue(launchPreparedTask);
    const executeAppGenerationRequest = vi.fn().mockResolvedValue([{ status: 'success' }]);

    const result = await executeAppGenerationFlow({
      launchControllerInput: {
        persistenceDeps: {},
        launcherDeps: {},
        runtimeDeps: {}
      },
      createGenerationTaskLaunchController,
      executeAppGenerationRequest,
      requestInput: {
        count: 1,
        currentProjectId: 'project-1',
        currentMode: AppMode.IMAGE,
        activeParams: { prompt: 'hello' } as any,
        resolvedJobSource: 'studio',
        selectedReferenceRecords: [],
        projectName: 'Project',
        createSessionInput: {
          createResumeActionStep: vi.fn(),
          buildConsistencyProfile: vi.fn(),
          normalizeAssistantMode: vi.fn(),
          prepareGenerationLaunch: vi.fn()
        },
        createTaskFlowDepsBuilder: vi.fn(),
        playSuccessSound: vi.fn()
      }
    });

    expect(createGenerationTaskLaunchController).toHaveBeenCalledWith({
      persistenceDeps: {},
      launcherDeps: {},
      runtimeDeps: {}
    });
    expect(executeAppGenerationRequest).toHaveBeenCalledWith(expect.objectContaining({
      launchPreparedTask
    }));
    expect(result).toEqual([{ status: 'success' }]);
  });
});
