import { describe, expect, it, vi } from 'vitest';
import type { AgentJob, ToolCallRecord } from '../types';
import { resolveKeepCurrentAction } from '../services/appRequiresActionRuntime';

const createJob = (): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'requires_action',
  createdAt: 100,
  updatedAt: 100,
  source: 'studio',
  steps: [],
  artifacts: [],
  requiresAction: {
    type: 'review_output',
    message: 'continue'
  }
});

describe('appRequiresActionRuntime', () => {
  it('resolves keep-current through job persistence and task-view sync', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);
    const setTaskViews = vi.fn();
    const toolCall: ToolCallRecord = {
      id: 'tool-1',
      toolName: 'generate_image',
      args: { prompt: 'poster' },
      status: 'requires_action',
      result: {
        status: 'requires_action',
        jobId: 'job-1',
        requiresAction: {
          type: 'review_output',
          message: 'continue'
        }
      } as any
    };

    const resolved = await resolveKeepCurrentAction({
      toolCall,
      activeProjectId: 'project-1',
      loadAgentJobsByProject: vi.fn().mockResolvedValue([createJob()]),
      saveAgentJobSnapshot,
      tasksRef: {
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
      },
      setTaskViews,
      saveTaskView,
      deleteTaskView,
      projects: [{ id: 'project-1', name: 'Project One' } as any],
      now: () => 200,
      createId: () => 'step-keep'
    });

    expect(resolved).toMatchObject({
      id: 'job-1',
      status: 'completed',
      currentStepId: undefined,
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
