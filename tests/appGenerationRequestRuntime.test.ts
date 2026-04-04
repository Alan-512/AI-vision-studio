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

  it('uses explicit sequence frame prompts when they are provided', async () => {
    const prompts: string[] = [];
    const launchPreparedTask = vi.fn().mockImplementation(async (input: any): Promise<AgentToolResult> => {
      prompts.push(input.activeParams.prompt);
      expect(input.activeParams.numberOfImages).toBe(1);
      return { status: 'success' } as AgentToolResult;
    });

    await executeAppGenerationRequest({
      count: 2,
      currentProjectId: 'project-1',
      currentMode: AppMode.IMAGE,
      activeParams: {
        prompt: 'make a poster',
        numberOfImages: 2,
        sequenceFramePrompts: [
          'Frame 1: anchor raises hand',
          'Frame 2: anchor points at rain map'
        ]
      } as any,
      resolvedJobSource: 'studio',
      selectedReferenceRecords: [],
      createTaskFlowDepsBuilder: vi.fn().mockReturnValue(() => ({})),
      launchPreparedTask,
      createSessionInput: {
        projectName: 'Project',
        createResumeActionStep: vi.fn(),
        buildConsistencyProfile: vi.fn(),
        normalizeAssistantMode: vi.fn(),
        prepareGenerationLaunch: vi.fn()
      }
    });

    expect(prompts).toEqual([
      'Frame 1: anchor raises hand',
      'Frame 2: anchor points at rain map'
    ]);
  });

  it('passes per-frame activeParams into downstream task flow deps', async () => {
    const downstreamPrompts: string[] = [];
    const createTaskFlowDepsBuilder = vi.fn().mockReturnValue((input: any) => {
      downstreamPrompts.push(input.activeParams.prompt);
      expect(input.activeParams.numberOfImages).toBe(1);
      return {};
    });
    const launchPreparedTask = vi.fn().mockImplementation(async (input: any): Promise<AgentToolResult> => {
      input.buildTaskRuntimeDeps({
        taskRuntime: {},
        getAgentJob: vi.fn(),
        stepId: 'step-1',
        taskId: 'task-1',
        jobId: 'job-1',
        currentProjectId: input.currentProjectId,
        activeParams: input.activeParams,
        initialPendingAsset: undefined,
        signal: new AbortController().signal,
        selectedReferenceRecords: [],
        historyForGeneration: input.historyForGeneration
      });
      return { status: 'success' } as AgentToolResult;
    });

    await executeAppGenerationRequest({
      count: 2,
      currentProjectId: 'project-1',
      currentMode: AppMode.IMAGE,
      activeParams: {
        prompt: 'make a poster',
        numberOfImages: 2,
        sequenceFramePrompts: [
          'Frame 1: anchor raises hand',
          'Frame 2: anchor points at rain map'
        ]
      } as any,
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

    expect(downstreamPrompts).toEqual([
      'Frame 1: anchor raises hand',
      'Frame 2: anchor points at rain map'
    ]);
  });

  it('rejects sequence generation requests with duplicate explicit frame prompts', async () => {
    await expect(executeAppGenerationRequest({
      count: 2,
      currentProjectId: 'project-1',
      currentMode: AppMode.IMAGE,
      activeParams: {
        prompt: 'make a poster',
        numberOfImages: 2,
        sequenceFramePrompts: [
          'Duplicate frame',
          'Duplicate frame'
        ]
      } as any,
      resolvedJobSource: 'studio',
      selectedReferenceRecords: [],
      createTaskFlowDepsBuilder: vi.fn().mockReturnValue(() => ({})),
      launchPreparedTask: vi.fn(),
      createSessionInput: {
        projectName: 'Project',
        createResumeActionStep: vi.fn(),
        buildConsistencyProfile: vi.fn(),
        normalizeAssistantMode: vi.fn(),
        prepareGenerationLaunch: vi.fn()
      }
    })).rejects.toThrow('distinct frame prompts');
  });
});
