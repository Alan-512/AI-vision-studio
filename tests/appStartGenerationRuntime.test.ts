import { describe, expect, it, vi } from 'vitest';
import { executeAppStartGeneration } from '../services/appStartGenerationRuntime';

describe('appStartGenerationRuntime', () => {
  it('creates the launch controller and executes the prepared app request from resolved bindings', async () => {
    const launchPreparedTask = vi.fn();
    const createGenerationTaskLaunchController = vi.fn().mockReturnValue(launchPreparedTask);
    const executeAppGenerationRequest = vi.fn().mockResolvedValue([{ status: 'success' }]);
    const resolveGenerationBindings = vi.fn().mockReturnValue({
      launchControllerInput: {
        persistenceDeps: {},
        launcherDeps: {},
        runtimeDeps: {}
      },
      requestInput: {
        currentProjectId: 'project-1'
      }
    });

    const result = await executeAppStartGeneration({
      kind: 'generation_request',
      input: {
        bindingKey: 'generation-1',
        currentProjectId: 'project-1',
        resolvedJobSource: 'studio'
      },
      createGenerationTaskLaunchController,
      executeAppGenerationRequest,
      resolveGenerationBindings
    });

    expect(resolveGenerationBindings).toHaveBeenCalledWith('generation-1');
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

  it('rejects start-generation payloads when bindings are missing', async () => {
    await expect(executeAppStartGeneration({
      kind: 'generation_request',
      input: {
        bindingKey: 'missing'
      } as any,
      createGenerationTaskLaunchController: vi.fn(),
      executeAppGenerationRequest: vi.fn(),
      resolveGenerationBindings: vi.fn().mockReturnValue(undefined)
    })).rejects.toThrow('Missing start-generation bindings');
  });
});
