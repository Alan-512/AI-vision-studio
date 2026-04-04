import { describe, expect, it } from 'vitest';
import { createAgentKernel } from '../services/agentKernel';

describe('agentKernel', () => {
  it('completes a text-only turn without creating an AgentJob', async () => {
    const kernel = createAgentKernel({
      planner: async () => ({
        type: 'final_response',
        text: 'Here is the answer.'
      })
    });

    const result = await kernel.submitUserTurn({
      turnId: 'turn-1',
      sessionId: 'session-1',
      userMessage: 'Answer directly.'
    });

    expect(result.turn.status).toBe('completed');
    expect(result.turn.outputText).toBe('Here is the answer.');
    expect(result.jobTransition).toBeUndefined();
  });

  it('reinjects interactive tool results back into the same turn before completion', async () => {
    const planner = async ({ normalizedToolResults }: { normalizedToolResults?: unknown[] }) => {
      if (!normalizedToolResults?.length) {
        return {
          type: 'tool_calls',
          toolCalls: [{
            toolName: 'memory_search',
            args: {
              query: 'poster'
            }
          }]
        } as const;
      }

      return {
        type: 'final_response',
        text: 'Used tool results.'
      } as const;
    };

    const kernel = createAgentKernel({
      planner,
      tools: [{
        name: 'memory_search',
        toolClass: 'interactive_tool',
        execute: async () => ({
          status: 'success',
          content: {
            memories: ['poster memory']
          }
        })
      }]
    });

    const result = await kernel.submitUserTurn({
      turnId: 'turn-2',
      sessionId: 'session-1',
      userMessage: 'Use memory first.'
    });

    expect(result.turn.status).toBe('completed');
    expect(result.events.map(event => event.type)).toContain('ToolResultsReinjected');
    expect(result.turn.outputText).toBe('Used tool results.');
  });

  it('returns a job transition for job tools instead of blindly reinjecting them', async () => {
    const kernel = createAgentKernel({
      planner: async () => ({
        type: 'tool_calls',
        toolCalls: [{
          toolName: 'generate_image',
          args: {
            prompt: 'weather anchor'
          }
        }]
      }),
      tools: [{
        name: 'generate_image',
        toolClass: 'job_tool',
        execute: async () => ({
          status: 'success',
          jobTransition: {
            jobId: 'job-77',
            lifecycle: 'queued'
          }
        })
      }]
    });

    const result = await kernel.submitUserTurn({
      turnId: 'turn-3',
      sessionId: 'session-1',
      userMessage: 'Generate a weather frame.'
    });

    expect(result.turn.status).toBe('waiting_on_job');
    expect(result.turn.activeJobId).toBe('job-77');
    expect(result.jobTransition).toMatchObject({
      job: {
        id: 'job-77',
        status: 'queued'
      }
    });
  });

  it('handles ResolveRequiresAction as a formal kernel command', async () => {
    const kernel = createAgentKernel({
      planner: async () => ({
        type: 'final_response',
        text: 'unused'
      }),
      resolveRequiresAction: async command => ({
        job: {
          id: command.jobId,
          projectId: 'project-1',
          type: 'IMAGE_GENERATION',
          status: 'completed',
          createdAt: 1,
          updatedAt: 2,
          source: 'chat',
          steps: [],
          artifacts: []
        },
        events: [],
        toolResult: undefined
      })
    });

    const result = await kernel.dispatchCommand({
      type: 'ResolveRequiresAction',
      jobId: 'job-9',
      resolutionType: 'review_output',
      payload: {
        stepId: 'step-keep'
      }
    });

    expect(result.jobTransition).toMatchObject({
      job: {
        id: 'job-9',
        status: 'completed'
      }
    });
    expect(result.events.map(event => event.type)).toContain('JobTransitioned');
  });

  it('handles CancelJob and ResumeJob as kernel-owned commands', async () => {
    const kernel = createAgentKernel({
      planner: async () => ({
        type: 'final_response',
        text: 'unused'
      }),
      cancelJob: async command => ({
        job: {
          id: command.jobId,
          projectId: 'project-1',
          type: 'IMAGE_GENERATION',
          status: 'cancelled',
          createdAt: 1,
          updatedAt: 2,
          source: 'chat',
          steps: [],
          artifacts: []
        },
        events: [],
        toolResult: undefined
      }),
      resumeJob: async command => ({
        job: {
          id: command.jobId,
          projectId: 'project-1',
          type: 'IMAGE_GENERATION',
          status: 'queued',
          createdAt: 1,
          updatedAt: 2,
          source: 'chat',
          steps: [],
          artifacts: []
        },
        events: [],
        toolResult: undefined
      })
    });

    const cancelled = await kernel.dispatchCommand({
      type: 'CancelJob',
      jobId: 'job-cancel',
      reason: 'user'
    });
    const resumed = await kernel.dispatchCommand({
      type: 'ResumeJob',
      jobId: 'job-resume',
      actionType: 'continue'
    });

    expect(cancelled.jobTransition?.job.status).toBe('cancelled');
    expect(resumed.jobTransition?.job.status).toBe('queued');
  });

  it('promotes ExecuteToolCalls job results into a waiting-on-job transition', async () => {
    const kernel = createAgentKernel({
      planner: async () => ({
        type: 'final_response',
        text: 'unused'
      }),
      executeToolCalls: async command => command.toolCalls.map(toolCall => ({
        toolName: toolCall.toolName,
        status: 'success',
        jobId: 'job-tool-call',
        metadata: {
          runtimeEvents: [{ type: 'AssetProduced' }]
        }
      }))
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

    expect(result.turn.status).toBe('waiting_on_job');
    expect(result.turn.activeJobId).toBe('job-tool-call');
    expect(result.toolResults).toMatchObject([{
      toolName: 'generate_image',
      status: 'success',
      jobId: 'job-tool-call',
      metadata: {
        runtimeEvents: [{ type: 'AssetProduced' }]
      }
    }]);
    expect(result.jobTransition).toMatchObject({
      job: {
        id: 'job-tool-call',
        projectId: 'project-1',
        status: 'queued'
      },
      events: [{
        type: 'JobQueued',
        payload: {
          source: 'chat'
        }
      }, {
        type: 'AssetProduced'
      }]
    });
  });

  it('promotes StartGeneration tool results into a waiting-on-job transition when a job id is returned', async () => {
    const kernel = createAgentKernel({
      planner: async () => ({
        type: 'final_response',
        text: 'unused'
      }),
      startGeneration: async () => ([
        {
          status: 'success',
          toolName: 'generate_image',
          jobId: 'job-start-1',
          metadata: {
            runtimeEvents: [{ type: 'ReviewStarted' }]
          }
        }
      ])
    });

    const result = await kernel.dispatchCommand({
      type: 'StartGeneration',
      payload: {
        kind: 'generation_request',
        input: {
          bindingKey: 'generation-1',
          currentProjectId: 'project-1',
          resolvedJobSource: 'studio'
        }
      }
    });

    expect(result.turn.status).toBe('waiting_on_job');
    expect(result.turn.activeJobId).toBe('job-start-1');
    expect(result.jobTransition).toMatchObject({
      job: {
        id: 'job-start-1',
        projectId: 'project-1',
        source: 'studio',
        status: 'queued'
      },
      events: [{
        type: 'JobQueued',
        payload: {
          source: 'studio'
        }
      }, {
        type: 'ReviewStarted'
      }]
    });
  });

  it('promotes StartGeneration terminal job snapshots without forcing waiting_on_job', async () => {
    const kernel = createAgentKernel({
      planner: async () => ({
        type: 'final_response',
        text: 'unused'
      }),
      startGeneration: async () => ([
        {
          status: 'success',
          toolName: 'generate_image',
          jobId: 'job-start-terminal',
          metadata: {
            jobSnapshot: {
              id: 'job-start-terminal',
              projectId: 'project-1',
              type: 'IMAGE_GENERATION',
              status: 'completed',
              createdAt: 1,
              updatedAt: 2,
              source: 'studio',
              steps: [],
              artifacts: []
            },
            runtimeEvents: [{ type: 'ReviewCompleted' }, { type: 'JobCompleted' }]
          }
        }
      ])
    });

    const result = await kernel.dispatchCommand({
      type: 'StartGeneration',
      payload: {
        kind: 'generation_request',
        input: {
          bindingKey: 'generation-terminal',
          currentProjectId: 'project-1',
          resolvedJobSource: 'studio'
        }
      }
    });

    expect(result.turn.status).toBe('completed');
    expect(result.turn.activeJobId).toBeUndefined();
    expect(result.jobTransition).toMatchObject({
      job: {
        id: 'job-start-terminal',
        status: 'completed'
      },
      events: [
        { type: 'ReviewCompleted' },
        { type: 'JobCompleted' }
      ]
    });
  });

  it('fails StartGeneration turns when tool results return an immediate error without a job', async () => {
    const kernel = createAgentKernel({
      planner: async () => ({
        type: 'final_response',
        text: 'unused'
      }),
      startGeneration: async () => ([
        {
          status: 'error',
          toolName: 'generate_image',
          error: 'quota exceeded'
        }
      ])
    });

    const result = await kernel.dispatchCommand({
      type: 'StartGeneration',
      payload: {
        kind: 'generation_request',
        input: {
          launchControllerInput: {},
          requestInput: {
            currentProjectId: 'project-1',
            resolvedJobSource: 'studio'
          }
        }
      }
    });

    expect(result.turn.status).toBe('failed');
    expect(result.turn.error?.type).toBe('tool_error');
    expect(result.events.map(event => event.type)).toContain('TurnFailed');
    expect(result.toolResults).toMatchObject([{
      toolName: 'generate_image',
      status: 'error',
      error: 'quota exceeded'
    }]);
  });

  it('fails ExecuteToolCalls turns when tool results return an immediate error without a job', async () => {
    const kernel = createAgentKernel({
      planner: async () => ({
        type: 'final_response',
        text: 'unused'
      }),
      executeToolCalls: async () => ([
        {
          toolName: 'generate_image',
          status: 'error',
          error: 'Tool execution failed'
        }
      ])
    });

    const result = await kernel.dispatchCommand({
      type: 'ExecuteToolCalls',
      turnId: 'turn-tool-call-error',
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

    expect(result.turn.status).toBe('failed');
    expect(result.turn.error?.type).toBe('tool_error');
    expect(result.events.map(event => event.type)).toContain('TurnFailed');
    expect(result.toolResults).toMatchObject([{
      toolName: 'generate_image',
      status: 'error',
      error: 'Tool execution failed'
    }]);
  });
});
