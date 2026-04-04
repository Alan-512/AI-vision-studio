import { describe, expect, it, vi } from 'vitest';
import type { AgentJob } from '../types';
import { createAppAgentKernel } from '../services/appAgentKernelRuntime';

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

describe('appAgentKernelRuntime', () => {
  it('resolves keep-current through the composed app kernel', async () => {
    const executeResolveRequiresAction = vi.fn().mockResolvedValue({
      job: {
        ...createJob(),
        status: 'completed',
        updatedAt: 200
      },
      events: [],
      toolResult: undefined
    });
    const kernel = createAppAgentKernel({
      executeResolveRequiresAction
    });

    const result = await kernel.dispatchCommand({
      type: 'ResolveRequiresAction',
      jobId: 'job-1',
      resolutionType: 'review_output',
      payload: {
        prompt: 'poster',
        stepId: 'step-keep'
      }
    });

    expect(executeResolveRequiresAction).toHaveBeenCalledWith({
      type: 'ResolveRequiresAction',
      jobId: 'job-1',
      resolutionType: 'review_output',
      payload: {
        prompt: 'poster',
        stepId: 'step-keep'
      }
    });
    expect(result.jobTransition?.job).toMatchObject({
      id: 'job-1',
      status: 'completed',
      updatedAt: 200
    });
  });

  it('cancels a job through the composed app kernel', async () => {
    const executeCancelJob = vi.fn().mockResolvedValue({
      job: {
        ...createJob({
          status: 'cancelled',
          updatedAt: 200
        })
      },
      events: [],
      toolResult: undefined
    });
    const kernel = createAppAgentKernel({
      executeCancelJob
    });

    const result = await kernel.dispatchCommand({
      type: 'CancelJob',
      jobId: 'job-1',
      reason: 'user'
    });

    expect(executeCancelJob).toHaveBeenCalledWith({
      type: 'CancelJob',
      jobId: 'job-1',
      reason: 'user'
    });
    expect(result.jobTransition?.job.status).toBe('cancelled');
  });

  it('bridges StartGeneration through the composed app kernel', async () => {
    const executeStartGeneration = vi.fn().mockResolvedValue([
      {
        status: 'success',
        toolName: 'generate_image',
        jobId: 'job-1'
      }
    ]);
    const kernel = createAppAgentKernel({
      executeStartGeneration
    });

    const result = await kernel.dispatchCommand({
      type: 'StartGeneration',
      payload: {
        kind: 'generation_request',
        input: {
          launchControllerInput: {
            persistenceDeps: {},
            launcherDeps: {},
            runtimeDeps: {}
          },
          requestInput: {
            currentProjectId: 'project-1',
            resolvedJobSource: 'studio'
          }
        }
      }
    });

    expect(executeStartGeneration).toHaveBeenCalledWith({
      kind: 'generation_request',
      input: {
        launchControllerInput: {
          persistenceDeps: {},
          launcherDeps: {},
          runtimeDeps: {}
        },
        requestInput: {
          currentProjectId: 'project-1',
          resolvedJobSource: 'studio'
        }
      }
    });
    expect(result.toolResults).toEqual([{
      status: 'success',
      toolName: 'generate_image',
      jobId: 'job-1'
    }]);
    expect(result.jobTransition?.job).toMatchObject({
      projectId: 'project-1',
      source: 'studio',
      status: 'queued'
    });
    expect(result.jobTransition?.events).toMatchObject([{
      type: 'JobQueued',
      payload: {
        source: 'studio'
      }
    }]);
  });

  it('bridges ExecuteToolCalls through the composed app kernel', async () => {
    const executeToolCalls = vi.fn().mockResolvedValue([{
      status: 'success',
      toolName: 'generate_image',
      jobId: 'job-tool-call'
    }]);
    const kernel = createAppAgentKernel({
      executeToolCalls
    });

    const result = await kernel.dispatchCommand({
      type: 'ExecuteToolCalls',
      turnId: 'turn-tool-call',
      sessionId: 'project-1',
      projectId: 'project-1',
      source: 'chat',
      toolCalls: [{
        toolName: 'generate_image',
        args: {
          prompt: 'poster'
        }
      }]
    });

    expect(executeToolCalls).toHaveBeenCalledWith({
      type: 'ExecuteToolCalls',
      turnId: 'turn-tool-call',
      sessionId: 'project-1',
      projectId: 'project-1',
      source: 'chat',
      toolCalls: [{
        toolName: 'generate_image',
        args: {
          prompt: 'poster'
        }
      }]
    });
    expect(result.turn.status).toBe('waiting_on_job');
    expect(result.turn.activeJobId).toBe('job-tool-call');
    expect(result.toolResults).toEqual([{
      status: 'success',
      toolName: 'generate_image',
      jobId: 'job-tool-call'
    }]);
    expect(result.jobTransition).toMatchObject({
      job: {
        id: 'job-tool-call',
        status: 'queued'
      },
      events: [{
        type: 'JobQueued',
        payload: {
          source: 'chat'
        }
      }]
    });
  });

  it('bridges SubmitUserTurn through the composed app kernel', async () => {
    const executeSubmitUserTurn = vi.fn().mockResolvedValue({
      turnOutput: {
        streamed: true
      }
    });
    const kernel = createAppAgentKernel({
      executeSubmitUserTurn
    });

    const result = await kernel.dispatchCommand({
      type: 'SubmitUserTurn',
      turn: {
        id: 'turn-1',
        sessionId: 'project-1',
        userMessage: 'hello',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
        plannedToolCalls: [],
        toolResults: []
      },
      payload: {
        kind: 'streaming_turn',
        input: {
          sendingProjectId: 'project-1',
          userMessage: 'hello'
        }
      } as any
    });

    expect(executeSubmitUserTurn).toHaveBeenCalledWith({
      kind: 'streaming_turn',
      input: expect.objectContaining({
        userMessage: 'hello'
      })
    });
    expect(result.turnOutput).toEqual({
      streamed: true
    });
  });

  it('requires an explicit submit-turn handler', async () => {
    const kernel = createAppAgentKernel({});

    await expect(kernel.dispatchCommand({
      type: 'SubmitUserTurn',
      turn: {
        id: 'turn-2',
        sessionId: 'project-1',
        userMessage: 'hello',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
        plannedToolCalls: [],
        toolResults: [],
        outputText: undefined
      }
    } as any)).rejects.toThrow('No app submit-turn handler configured');
  });

  it('bridges ResumeJob through the composed app kernel', async () => {
    const executeResumeJob = vi.fn().mockResolvedValue({
      job: {
        ...createJob(),
        status: 'queued',
        updatedAt: 200,
        lastError: undefined,
        requiresAction: undefined
      },
      events: [],
      toolResult: undefined
    });
    const kernel = createAppAgentKernel({
      loadAgentJobsByProject: vi.fn().mockResolvedValue([createJob()]),
      projectIdRef: { current: 'project-1' },
      executeResumeJob
    });

    const result = await kernel.dispatchCommand({
      type: 'ResumeJob',
      jobId: 'job-1',
      actionType: 'review_output'
    });

    expect(executeResumeJob).toHaveBeenCalledWith({
      type: 'ResumeJob',
      jobId: 'job-1',
      actionType: 'review_output'
    });
    expect(result.jobTransition?.job.status).toBe('queued');
  });

  it('requires an explicit resume-job handler', async () => {
    const kernel = createAppAgentKernel({});

    await expect(kernel.dispatchCommand({
      type: 'ResumeJob',
      jobId: 'job-1',
      actionType: 'review_output'
    })).rejects.toThrow('No app resume-job handler configured');
  });
});
