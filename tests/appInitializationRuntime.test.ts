import { describe, expect, it, vi } from 'vitest';
import type { AgentJob, BackgroundTask, Project } from '../types';
import { recoverPersistedTaskViews } from '../services/appInitializationRuntime';

describe('appInitializationRuntime', () => {
  it('marks interruptible jobs as interrupted and derives recovered task views', async () => {
    const persistedTaskViews: BackgroundTask[] = [{
      id: 'task-1',
      type: 'IMAGE_GENERATION',
      status: 'GENERATING',
      progress: 0,
      projectId: 'project-1',
      projectName: 'Project One',
      prompt: 'draw a tree',
      createdAt: 1,
      startedAt: 1,
      jobId: 'job-1'
    }];
    const persistedAgentJobs: AgentJob[] = [{
      id: 'job-1',
      projectId: 'project-1',
      mode: 'IMAGE',
      source: 'chat',
      status: 'executing',
      prompt: 'draw a tree',
      paramsSnapshot: {} as any,
      createdAt: 1,
      updatedAt: 1,
      steps: [{
        id: 'step-1',
        kind: 'generation',
        name: 'generate_image',
        status: 'running'
      } as any],
      artifacts: []
    }];
    const projects: Project[] = [{
      id: 'project-1',
      name: 'Project One',
      createdAt: 1,
      updatedAt: 1,
      savedMode: 'IMAGE' as any,
      chatHistory: [],
      videoChatHistory: []
    }];
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);

    const result = await recoverPersistedTaskViews({
      persistedTaskViews,
      persistedAgentJobs,
      projects,
      saveAgentJobSnapshot,
      saveTaskView,
      deleteTaskView,
      now: () => 100
    });

    expect(result.recoveredAgentJobs[0]).toMatchObject({
      status: 'interrupted',
      currentStepId: undefined,
      lastError: 'Job interrupted by page refresh',
      updatedAt: 100
    });
    expect(result.recoveredAgentJobs[0].steps[0]).toMatchObject({
      status: 'failed',
      error: 'Job interrupted by page refresh',
      endTime: 100
    });
    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(1);
    expect(saveTaskView).toHaveBeenCalled();
    expect(result.recoveredTaskViews[0]).toMatchObject({
      jobId: 'job-1',
      projectId: 'project-1'
    });
  });

  it('leaves non-interruptible jobs untouched', async () => {
    const completedJob: AgentJob = {
      id: 'job-1',
      projectId: 'project-1',
      mode: 'IMAGE',
      source: 'chat',
      status: 'completed',
      prompt: 'done',
      paramsSnapshot: {} as any,
      createdAt: 1,
      updatedAt: 1,
      steps: [],
      artifacts: []
    };

    const result = await recoverPersistedTaskViews({
      persistedTaskViews: [],
      persistedAgentJobs: [completedJob],
      projects: [],
      saveAgentJobSnapshot: vi.fn(),
      saveTaskView: vi.fn(),
      deleteTaskView: vi.fn(),
      now: () => 100
    });

    expect(result.recoveredAgentJobs).toEqual([completedJob]);
  });
});
