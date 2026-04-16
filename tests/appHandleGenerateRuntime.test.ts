import { describe, expect, it, vi } from 'vitest';
import { AppMode } from '../types';
import { createAppHandleGenerate } from '../services/appHandleGenerateRuntime';

describe('appHandleGenerateRuntime', () => {
  it('returns an empty result when preflight blocks generation', async () => {
    const handleGenerate = createAppHandleGenerate({
      prepareRequest: vi.fn().mockResolvedValue(null),
      buildTaskFlowDepsBuilder: vi.fn(),
      executeGenerationFlow: vi.fn(),
      getProjectName: vi.fn(),
      computeHistoryForGeneration: vi.fn()
    });

    const result = await handleGenerate({ prompt: 'hello' } as any);

    expect(result).toEqual([]);
  });

  it('runs generation flow with preflight output and constructed request input', async () => {
    const prepareRequest = vi.fn().mockResolvedValue({
      userKey: 'key',
      activeParams: { prompt: 'hello' },
      currentProjectId: 'project-1',
      currentMode: AppMode.IMAGE,
      resolvedJobSource: 'chat',
      triggerMessageTimestamp: 123
    });
    const createTaskFlowDepsBuilder = vi.fn();
    const executeGenerationFlow = vi.fn().mockResolvedValue([{ status: 'success', toolName: 'generate_image', jobId: 'job-1' }]);
    const computeHistoryForGeneration = vi.fn().mockReturnValue(['history']);
    const handleGenerate = createAppHandleGenerate({
      prepareRequest,
      buildTaskFlowDepsBuilder: () => createTaskFlowDepsBuilder,
      executeGenerationFlow,
      getProjectName: vi.fn().mockReturnValue('Project One'),
      computeHistoryForGeneration
    });

    const result = await handleGenerate({ prompt: 'hello' } as any, {
      generationSurface: 'assistant',
      resumeJobId: 'job-1',
      resumeActionType: 'review_output',
      selectedReferenceRecords: [{ id: 'ref-1' }] as any,
      searchContextOverride: { queries: ['q'] } as any
    }, {
      launchControllerInput: {
        persistenceDeps: {},
        launcherDeps: {},
        runtimeDeps: {}
      },
      createGenerationTaskLaunchController: vi.fn(),
      executeAppGenerationRequest: vi.fn(),
      dispatchKernelCommand: vi.fn(),
      createSessionInput: {
        createResumeActionStep: vi.fn(),
        buildConsistencyProfile: vi.fn(),
        normalizeAssistantMode: vi.fn(),
        prepareGenerationLaunch: vi.fn()
      },
      playSuccessSound: vi.fn()
    } as any);

    expect(prepareRequest).toHaveBeenCalled();
    expect(executeGenerationFlow).toHaveBeenCalledWith(expect.objectContaining({
      requestInput: expect.objectContaining({
        currentProjectId: 'project-1',
        projectName: 'Project One',
        generationSurface: 'assistant',
        resumeJobId: 'job-1',
        resumeActionType: 'review_output',
        selectedReferenceRecords: [{ id: 'ref-1' }],
        searchContextOverride: { queries: ['q'] },
        historyForGeneration: ['history'],
        createTaskFlowDepsBuilder
      })
    }));
    expect(result).toEqual([{ status: 'success', toolName: 'generate_image', jobId: 'job-1' }]);
  });
});
