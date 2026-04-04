import { describe, expect, it, vi } from 'vitest';
import type { AgentJob, BackgroundTask, Project } from '../types';
import {
  rebuildTaskViewProjections,
  recoverWriteModelsAndRebuildProjections,
  repairInterruptedAgentJobs
} from '../services/projectionRecoveryRuntime';

const createProject = (): Project => ({
  id: 'project-1',
  name: 'Project One',
  createdAt: 1,
  updatedAt: 1,
  savedMode: 'IMAGE' as any,
  chatHistory: [],
  videoChatHistory: []
});

const createInterruptibleJob = (): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  source: 'chat',
  status: 'executing',
  createdAt: 1,
  updatedAt: 1,
  currentStepId: 'step-1',
  steps: [{
    id: 'step-1',
    kind: 'generation',
    name: 'generate_image',
    status: 'running',
    input: {
      prompt: 'draw a tree'
    }
  }],
  artifacts: []
});

const createPersistedTaskView = (): BackgroundTask => ({
  id: 'task-1',
  type: 'IMAGE',
  status: 'GENERATING',
  projectId: 'project-1',
  projectName: 'Project One',
  prompt: 'draw a tree',
  startTime: 1,
  executionStartTime: 1,
  jobId: 'job-1'
});

describe('projectionRecoveryRuntime', () => {
  it('repairs interrupted jobs before rebuilding projections', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);

    const recoveredJobs = await repairInterruptedAgentJobs({
      persistedAgentJobs: [createInterruptibleJob()],
      saveAgentJobSnapshot,
      now: () => 100
    });

    expect(recoveredJobs[0]).toMatchObject({
      status: 'interrupted',
      currentStepId: undefined,
      lastError: 'Job interrupted by page refresh',
      updatedAt: 100
    });
    expect(recoveredJobs[0].steps[0]).toMatchObject({
      status: 'failed',
      error: 'Job interrupted by page refresh',
      endTime: 100
    });
    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(1);
  });

  it('rebuilds task views from recovered jobs instead of trusting stale projection state', async () => {
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);

    const result = await rebuildTaskViewProjections({
      persistedTaskViews: [createPersistedTaskView()],
      recoveredAgentJobs: [{
        ...createInterruptibleJob(),
        status: 'interrupted',
        lastError: 'Job interrupted by page refresh',
        updatedAt: 100,
        currentStepId: undefined,
        steps: [{
          ...createInterruptibleJob().steps[0],
          status: 'failed',
          endTime: 100,
          error: 'Job interrupted by page refresh'
        }]
      }],
      projects: [createProject()],
      saveTaskView,
      deleteTaskView
    });

    expect(result.recoveredTaskViews[0]).toMatchObject({
      jobId: 'job-1',
      projectId: 'project-1',
      status: 'FAILED',
      error: 'Job interrupted by page refresh'
    });
    expect(saveTaskView).toHaveBeenCalled();
  });

  it('runs the full write-model recovery flow in one entrypoint', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveTaskView = vi.fn().mockResolvedValue(undefined);
    const deleteTaskView = vi.fn().mockResolvedValue(undefined);

    const result = await recoverWriteModelsAndRebuildProjections({
      persistedTaskViews: [createPersistedTaskView()],
      persistedAgentJobs: [createInterruptibleJob()],
      projects: [createProject()],
      saveAgentJobSnapshot,
      saveTaskView,
      deleteTaskView,
      now: () => 100
    });

    expect(result.recoveredAgentJobs[0].status).toBe('interrupted');
    expect(result.recoveredTaskViews[0].status).toBe('FAILED');
    expect(saveAgentJobSnapshot).toHaveBeenCalledTimes(1);
    expect(saveTaskView).toHaveBeenCalled();
  });
});
