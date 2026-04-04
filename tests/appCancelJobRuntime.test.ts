import { describe, expect, it, vi } from 'vitest';
import type { AgentJob } from '../types';
import { executeAppCancelJob } from '../services/appCancelJobRuntime';

const createJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'executing',
  createdAt: 100,
  updatedAt: 100,
  source: 'chat',
  currentStepId: 'step-1',
  steps: [{
    id: 'step-1',
    kind: 'generation',
    name: 'generate_image',
    status: 'running',
    input: {},
    output: {}
  }],
  artifacts: [],
  ...overrides
});

describe('appCancelJobRuntime', () => {
  it('persists a cancelled job and syncs related task views', async () => {
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
        status: 'RUNNING',
        startTime: 100,
        prompt: 'poster'
      }]
    };

    const result = await executeAppCancelJob({
      command: {
        type: 'CancelJob',
        jobId: 'job-1',
        reason: 'user'
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
      status: 'cancelled',
      updatedAt: 200
    });
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      id: 'job-1',
      status: 'cancelled'
    }));
    expect(saveTaskView).toHaveBeenCalled();
    expect(deleteTaskView).not.toHaveBeenCalled();
    expect(setTaskViews).toHaveBeenCalledTimes(1);
    expect(result.events.map(event => event.type)).toEqual(['JobCancelled']);
  });
});
