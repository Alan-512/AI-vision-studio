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

  it('handles ExecuteToolCalls as a formal kernel command', async () => {
    const kernel = createAgentKernel({
      planner: async () => ({
        type: 'final_response',
        text: 'unused'
      }),
      executeToolCalls: async command => command.toolCalls.map(toolCall => ({
        toolName: toolCall.toolName,
        status: 'success',
        jobId: 'job-tool-call'
      }))
    });

    const result = await kernel.dispatchCommand({
      type: 'ExecuteToolCalls',
      turnId: 'turn-tool-call',
      toolCalls: [{
        toolName: 'generate_image',
        args: {
          prompt: 'poster'
        }
      }]
    });

    expect(result.toolResults).toEqual([{
      toolName: 'generate_image',
      status: 'success',
      jobId: 'job-tool-call'
    }]);
  });
});
