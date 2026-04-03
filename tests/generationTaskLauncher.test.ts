import { describe, expect, it, vi } from 'vitest';
import type { AgentJob, AgentToolResult, AssetItem, GenerationParams } from '../types';
import { createGenerationTaskLauncher } from '../services/generationTaskLauncher';

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

const createParams = (): GenerationParams => ({
  prompt: 'poster',
  savedImagePrompt: '',
  savedVideoPrompt: '',
  aspectRatio: '1:1' as any,
  imageModel: 'flash-3.1' as any,
  videoModel: 'veo-fast' as any,
  imageStyle: 'NONE' as any,
  videoStyle: 'NONE' as any,
  imageResolution: '1K' as any,
  videoResolution: '720P' as any,
  videoDuration: 'SHORT' as any,
  useGrounding: false,
  smartAssets: []
});

describe('generationTaskLauncher', () => {
  it('loads existing job, creates a task session, and executes the prepared flow', async () => {
    const controllerMap: Record<string, AbortController> = {};
    const createSession = vi.fn().mockResolvedValue({
      taskId: 'task-1',
      jobId: 'job-1',
      stepId: 'step-1',
      initialPendingAsset: {
        id: 'task-1',
        projectId: 'project-1',
        type: 'IMAGE',
        url: '',
        prompt: 'poster',
        createdAt: 1710000000000,
        status: 'PENDING'
      } as AssetItem,
      taskRuntime: { markTaskVisibleComplete: vi.fn() },
      getAgentJob: () => createJob()
    });
    const executePreparedGenerationTask = vi.fn().mockResolvedValue({
      toolName: 'generate_image',
      status: 'success'
    } as AgentToolResult);

    const launchTask = createGenerationTaskLauncher({
      deps: {
        loadExistingJob: vi.fn().mockResolvedValue(createJob({ id: 'job-1' })),
        getPreviousTaskIds: vi.fn().mockReturnValue(['task-old-1']),
        createTaskSession: createSession,
        executePreparedGenerationTask,
        createAbortController: () => new AbortController(),
        registerController: (taskId, controller) => {
          controllerMap[taskId] = controller;
        },
        unregisterController: taskId => {
          delete controllerMap[taskId];
        }
      }
    });

    const result = await launchTask({
      currentProjectId: 'project-1',
      currentMode: 'IMAGE' as any,
      activeParams: createParams(),
      resolvedJobSource: 'studio',
      triggerMessageTimestamp: 1710000000000,
      searchContextOverride: undefined,
      selectedReferenceRecords: [],
      resumeJobId: 'job-1',
      resumeActionType: undefined,
      toolCall: undefined,
      historyForGeneration: [],
      createSessionInput: {
        projectName: 'Project One',
        createResumeActionStep: vi.fn(),
        buildConsistencyProfile: vi.fn().mockReturnValue({ preserveSignals: [] }),
        normalizeAssistantMode: vi.fn().mockReturnValue(undefined),
        prepareGenerationLaunch: vi.fn()
      }
    });

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      previousTaskIds: ['task-old-1'],
      existingJob: expect.objectContaining({ id: 'job-1' })
    }));
    expect(executePreparedGenerationTask).toHaveBeenCalledWith(expect.objectContaining({
      currentProjectId: 'project-1',
      taskId: 'task-1',
      jobId: 'job-1',
      stepId: 'step-1'
    }));
    expect(result.status).toBe('success');
    expect(controllerMap['task-1']).toBeUndefined();
  });
});
