import { describe, expect, it, vi } from 'vitest';
import type { AgentJob } from '../types';
import { executeAppResolveRequiresAction } from '../services/appResolveRequiresActionRuntime';

const createJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'requires_action',
  createdAt: 100,
  updatedAt: 100,
  source: 'chat',
  currentStepId: 'step-1',
  steps: [{
    id: 'step-1',
    kind: 'review',
    name: 'review_output',
    status: 'failed',
    input: {},
    output: {}
  }],
  artifacts: [],
  requiresAction: {
    type: 'review_output',
    message: 'continue'
  },
  ...overrides
});

describe('appResolveRequiresActionRuntime', () => {
  it('persists a keep-current resolution and syncs related task views', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const setTaskViews = vi.fn();
    const tasksRef = {
      current: [{
        id: 'task-1',
        jobId: 'job-1',
        projectId: 'project-1',
        projectName: 'Project One',
        type: 'IMAGE',
        status: 'ACTION_REQUIRED',
        startTime: 100,
        prompt: 'poster'
      }]
    };

    const result = await executeAppResolveRequiresAction({
      command: {
        type: 'ResolveRequiresAction',
        jobId: 'job-1',
        resolutionType: 'review_output',
        payload: {
          stepId: 'step-keep',
          prompt: 'poster'
        }
      },
      activeProjectId: 'project-1',
      loadAgentJobsByProject: vi.fn().mockResolvedValue([createJob()]),
      saveAgentJobSnapshot,
      tasksRef,
      setTaskViews,
      saveTaskView,
      deleteTaskView,
      projects: [{ id: 'project-1', name: 'Project One' } as any],
      now: () => 200
    });

    expect(result.job).toMatchObject({
      id: 'job-1',
      status: 'completed',
      updatedAt: 200
    });
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      id: 'job-1',
      status: 'completed'
    }));
    expect(saveTaskView).toHaveBeenCalled();
    expect(deleteTaskView).not.toHaveBeenCalled();
    expect(setTaskViews).toHaveBeenCalledTimes(1);
  });
});
