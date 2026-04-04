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

  it('dispatches a StartGeneration kernel command when a dispatcher is provided', async () => {
    const dispatchKernelCommand = vi.fn().mockResolvedValue({
      turn: {
        id: 'kernel:StartGeneration:project-1',
        sessionId: 'kernel:StartGeneration',
        userMessage: 'StartGeneration',
        status: 'completed'
      },
      events: [],
      toolResults: [{ status: 'success', toolName: 'generate_image', jobId: 'job-1' }]
    });
    const createGenerationTaskLaunchController = vi.fn();
    const executeAppGenerationRequest = vi.fn();

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
      },
      dispatchKernelCommand
    });

    expect(dispatchKernelCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'StartGeneration',
      payload: {
        kind: 'generation_request',
        input: {
          launchControllerInput: {
            persistenceDeps: {},
            launcherDeps: {},
            runtimeDeps: {}
          },
          requestInput: expect.objectContaining({
            currentProjectId: 'project-1'
          })
        }
      }
    }));
    expect(createGenerationTaskLaunchController).not.toHaveBeenCalled();
    expect(executeAppGenerationRequest).not.toHaveBeenCalled();
    expect(result).toEqual([{ status: 'success', toolName: 'generate_image', jobId: 'job-1' }]);
  });

  it('dispatches ResumeJob before StartGeneration when resuming an existing job', async () => {
    const dispatchKernelCommand = vi
      .fn()
      .mockResolvedValueOnce({
        jobTransition: {
          job: {
            id: 'job-1',
            status: 'queued'
          }
        }
      })
      .mockResolvedValueOnce({
        turn: {
          id: 'kernel:StartGeneration:project-1',
          sessionId: 'kernel:StartGeneration',
          userMessage: 'StartGeneration',
          status: 'completed'
        },
        events: [],
        toolResults: [{ status: 'success', toolName: 'generate_image', jobId: 'job-1' }]
      });

    await executeAppGenerationFlow({
      launchControllerInput: {
        persistenceDeps: {},
        launcherDeps: {},
        runtimeDeps: {}
      },
      createGenerationTaskLaunchController: vi.fn(),
      executeAppGenerationRequest: vi.fn(),
      requestInput: {
        count: 1,
        currentProjectId: 'project-1',
        currentMode: AppMode.IMAGE,
        activeParams: { prompt: 'hello' } as any,
        resolvedJobSource: 'studio',
        selectedReferenceRecords: [],
        projectName: 'Project',
        resumeJobId: 'job-1',
        resumeActionType: 'review_output',
        createSessionInput: {
          createResumeActionStep: vi.fn(),
          buildConsistencyProfile: vi.fn(),
          normalizeAssistantMode: vi.fn(),
          prepareGenerationLaunch: vi.fn()
        },
        createTaskFlowDepsBuilder: vi.fn(),
        playSuccessSound: vi.fn()
      },
      dispatchKernelCommand
    });

    expect(dispatchKernelCommand).toHaveBeenNthCalledWith(1, {
      type: 'ResumeJob',
      jobId: 'job-1',
      actionType: 'review_output'
    });
    expect(dispatchKernelCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'StartGeneration'
    }));
  });
});
