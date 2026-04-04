import { describe, expect, it, vi } from 'vitest';
import type { AgentJob, AssetItem, BackgroundTaskView, GenerationParams } from '../types';
import { createGenerationTaskSession } from '../services/generationTaskSessionRuntime';

const createJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'queued',
  createdAt: 1710000000000,
  updatedAt: 1710000000001,
  source: 'studio',
  steps: [],
  artifacts: [],
  ...overrides
});

const createPendingAsset = (overrides: Partial<AssetItem> = {}): AssetItem => ({
  id: 'task-1',
  projectId: 'project-1',
  type: 'IMAGE',
  url: '',
  prompt: 'poster',
  createdAt: 1710000000000,
  status: 'PENDING',
  ...overrides
});

const createTaskView = (overrides: Partial<BackgroundTaskView> = {}): BackgroundTaskView => ({
  id: 'task-1',
  jobId: 'job-1',
  projectId: 'project-1',
  projectName: 'Project',
  type: 'IMAGE',
  status: 'QUEUED',
  startTime: 1710000000000,
  prompt: 'poster',
  ...overrides
});

describe('generationTaskSessionRuntime', () => {
  it('creates a task session and awaits dismiss before queued sync', async () => {
    const callOrder: string[] = [];
    const dismissTaskView = vi.fn().mockImplementation(async (taskId: string) => {
      callOrder.push(`dismiss:${taskId}`);
    });
    const initializeQueuedJob = vi.fn().mockImplementation(async (job: AgentJob) => {
      callOrder.push(`initialize:${job.id}`);
    });
    const createTaskRuntime = vi.fn().mockReturnValue({
      dismissTaskView,
      initializeQueuedJob
    });

    const result = await createGenerationTaskSession({
      currentProjectId: 'project-1',
      currentMode: 'IMAGE' as any,
      projectName: 'Project One',
      resolvedJobSource: 'studio',
      triggerMessageTimestamp: 1710000000000,
      activePrompt: 'poster',
      searchContextOverride: undefined,
      selectedReferenceRecords: [],
      existingJob: createJob({ id: 'job-1' }),
      previousTaskIds: ['task-old-1', 'task-old-2'],
      params: {} as GenerationParams,
      toolCall: undefined,
      resumeJobId: 'job-1',
      resumeActionType: undefined,
      createResumeActionStep: vi.fn().mockReturnValue(undefined),
      buildConsistencyProfile: vi.fn().mockReturnValue({ preserveSignals: [] }),
      normalizeAssistantMode: vi.fn().mockReturnValue(undefined),
      prepareGenerationLaunch: vi.fn().mockReturnValue({
        pendingAsset: createPendingAsset(),
        queuedJob: createJob({ id: 'job-1' })
      }),
      createTaskRuntime,
      now: () => 1710000000100,
      createId: vi.fn()
        .mockReturnValueOnce('task-1')
        .mockReturnValueOnce('step-1')
        .mockReturnValueOnce('resume-step-1')
    });

    expect(result.taskId).toBe('task-1');
    expect(result.stepId).toBe('step-1');
    expect(result.initialPendingAsset.id).toBe('task-1');
    expect(result.agentJob.id).toBe('job-1');
    expect(createTaskRuntime).toHaveBeenCalledWith(expect.objectContaining({ projectName: 'Project One' }));
    expect(dismissTaskView).toHaveBeenCalledTimes(2);
    expect(initializeQueuedJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
    expect(callOrder).toEqual([
      'dismiss:task-old-1',
      'dismiss:task-old-2',
      'initialize:job-1'
    ]);
  });
});
