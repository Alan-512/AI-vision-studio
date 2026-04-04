import { describe, expect, it } from 'vitest';
import { buildSequenceFramePrompts, createToolboxRuntime } from '../services/toolboxRuntime';
import { createTurnRuntimeState } from '../services/turnRuntimeState';

describe('toolboxRuntime', () => {
  it('reinjects interactive tool results into the same turn loop contract', async () => {
    const toolbox = createToolboxRuntime({
      tools: [{
        name: 'memory_search',
        toolClass: 'interactive_tool',
        execute: async () => ({
          status: 'success',
          content: {
            memories: ['poster reference']
          }
        })
      }]
    });

    const result = await toolbox.executeToolCalls({
      turn: createTurnRuntimeState({
        turnId: 'turn-1',
        sessionId: 'session-1',
        userMessage: 'Find memory references'
      }),
      toolCalls: [{
        toolName: 'memory_search',
        args: {
          query: 'poster'
        }
      }]
    });

    expect(result.normalizedResults).toHaveLength(1);
    expect(result.normalizedResults[0]).toMatchObject({
      toolClass: 'interactive_tool',
      reinject: true,
      status: 'success'
    });
  });

  it('normalizes job tools into job transition results instead of blind reinjection', async () => {
    const toolbox = createToolboxRuntime({
      tools: [{
        name: 'generate_image',
        toolClass: 'job_tool',
        execute: async () => ({
          status: 'success',
          jobTransition: {
            jobId: 'job-1',
            lifecycle: 'queued'
          }
        })
      }]
    });

    const result = await toolbox.executeToolCalls({
      turn: createTurnRuntimeState({
        turnId: 'turn-2',
        sessionId: 'session-1',
        userMessage: 'Generate an image'
      }),
      toolCalls: [{
        toolName: 'generate_image',
        args: {
          prompt: 'poster'
        }
      }]
    });

    expect(result.normalizedResults[0]).toMatchObject({
      toolClass: 'job_tool',
      reinject: false,
      status: 'success',
      jobTransition: {
        jobId: 'job-1',
        lifecycle: 'queued'
      }
    });
  });

  it('surfaces permission deny through the normalized result contract', async () => {
    const toolbox = createToolboxRuntime({
      tools: [{
        name: 'generate_image',
        toolClass: 'job_tool',
        execute: async () => ({
          status: 'success'
        }),
        permissionPolicy: 'deny',
        denyReason: 'disabled for this workspace'
      }]
    });

    const result = await toolbox.executeToolCalls({
      turn: createTurnRuntimeState({
        turnId: 'turn-3',
        sessionId: 'session-1',
        userMessage: 'Generate an image'
      }),
      toolCalls: [{
        toolName: 'generate_image',
        args: {
          prompt: 'poster'
        }
      }]
    });

    expect(result.normalizedResults[0]).toMatchObject({
      toolClass: 'job_tool',
      status: 'error',
      errorType: 'permission_denied',
      reinject: false
    });
  });

  it('builds distinct frame prompts for sequence generation requests', () => {
    const prompts = buildSequenceFramePrompts({
      basePrompt: 'Weather anchor in studio.',
      count: 4
    });

    expect(prompts).toHaveLength(4);
    expect(new Set(prompts).size).toBe(4);
    expect(prompts[0]).toContain('Sequence frame 1 of 4');
    expect(prompts[3]).toContain('Sequence frame 4 of 4');
  });
});
