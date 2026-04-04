import { describe, expect, it, vi } from 'vitest';
import { executeAppStartGeneration } from '../services/appStartGenerationRuntime';

describe('appStartGenerationRuntime', () => {
  it('creates the launch controller and executes the prepared app request', async () => {
    const launchPreparedTask = vi.fn();
    const createGenerationTaskLaunchController = vi.fn().mockReturnValue(launchPreparedTask);
    const executeAppGenerationRequest = vi.fn().mockResolvedValue([{ status: 'success' }]);

    const result = await executeAppStartGeneration({
      launchControllerInput: {
        persistenceDeps: {},
        launcherDeps: {},
        runtimeDeps: {}
      },
      requestInput: {
        currentProjectId: 'project-1'
      },
      createGenerationTaskLaunchController,
      executeAppGenerationRequest
    });

    expect(createGenerationTaskLaunchController).toHaveBeenCalledWith({
      persistenceDeps: {},
      launcherDeps: {},
      runtimeDeps: {}
    });
    expect(executeAppGenerationRequest).toHaveBeenCalledWith({
      currentProjectId: 'project-1',
      launchPreparedTask
    });
    expect(result).toEqual([{ status: 'success' }]);
  });
});
