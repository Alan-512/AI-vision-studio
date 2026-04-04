import { describe, expect, it, vi } from 'vitest';
import { AppMode, type AgentToolResult } from '../types';
import { executeAppGenerationRequest } from '../services/appGenerationRequestRuntime';

describe('appGenerationRequestRuntime', () => {
  it('launches prepared generation tasks with per-task flow deps', async () => {
    const prompts: string[] = [];
    const createTaskFlowDepsBuilder = vi.fn().mockReturnValue((input: any) => ({
      taskId: input.taskId,
      latestVisibleAssetRef: input.latestVisibleAssetRef,
      playVisibleSuccess: input.playVisibleSuccess
    }));
    const launchPreparedTask = vi.fn().mockImplementation(async (input: any): Promise<AgentToolResult> => {
      const deps = input.buildTaskRuntimeDeps({
        taskId: 'task-1',
        getAgentJob: vi.fn(),
        stepId: 'step-1',
        jobId: 'job-1',
        currentProjectId: input.currentProjectId,
        activeParams: input.activeParams,
        initialPendingAsset: undefined,
        signal: new AbortController().signal,
        selectedReferenceRecords: [],
        historyForGeneration: input.historyForGeneration
      });
      expect(deps.taskId).toBe('task-1');
      expect(typeof deps.playVisibleSuccess).toBe('function');
      expect(input.activeParams.numberOfImages).toBe(1);
      prompts.push(input.activeParams.prompt);
      return { status: 'success', summary: input.currentProjectId } as AgentToolResult;
    });

    const results = await executeAppGenerationRequest({
      count: 2,
      currentProjectId: 'project-1',
      currentMode: AppMode.IMAGE,
      activeParams: { prompt: 'make a poster', numberOfImages: 2 } as any,
      resolvedJobSource: 'studio',
      selectedReferenceRecords: [],
      createTaskFlowDepsBuilder,
      launchPreparedTask,
      createSessionInput: {
        projectName: 'Project',
        createResumeActionStep: vi.fn(),
        buildConsistencyProfile: vi.fn(),
        normalizeAssistantMode: vi.fn(),
        prepareGenerationLaunch: vi.fn()
      }
    });

    expect(createTaskFlowDepsBuilder).toHaveBeenCalledTimes(2);
    expect(launchPreparedTask).toHaveBeenCalledTimes(2);
    expect(new Set(prompts).size).toBe(2);
    expect(prompts[0]).toContain('Sequence frame 1 of 2');
    expect(prompts[1]).toContain('Sequence frame 2 of 2');
    expect(results).toEqual([
      { status: 'success', summary: 'project-1' },
      { status: 'success', summary: 'project-1' }
    ]);
  });
});
