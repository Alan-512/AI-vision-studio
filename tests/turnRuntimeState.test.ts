import { describe, expect, it } from 'vitest';
import type { AgentAction } from '../types';
import {
  attachTurnActiveJob,
  completeTurnRuntimeState,
  createTurnRuntimeState,
  failTurnRuntimeState,
  planTurnToolCalls
} from '../services/turnRuntimeState';

describe('turnRuntimeState', () => {
  it('keeps a text-only turn inside ephemeral turn state', () => {
    const turn = completeTurnRuntimeState(createTurnRuntimeState({
      turnId: 'turn-1',
      sessionId: 'session-1',
      userMessage: 'Summarize the last result.'
    }), {
      assistantText: 'Here is the summary.',
      now: 200
    });

    expect(turn.id).toBe('turn-1');
    expect(turn.status).toBe('completed');
    expect(turn.activeJobId).toBeUndefined();
    expect(turn.outputText).toBe('Here is the summary.');
  });

  it('records planned tool calls without creating a persisted job by itself', () => {
    const planned = planTurnToolCalls(createTurnRuntimeState({
      turnId: 'turn-2',
      sessionId: 'session-1',
      userMessage: 'Search related references.'
    }), {
      toolCalls: [{
        toolName: 'memory_search',
        args: {
          query: 'poster references'
        }
      } satisfies AgentAction],
      now: 120
    });

    expect(planned.status).toBe('planning');
    expect(planned.activeJobId).toBeUndefined();
    expect(planned.plannedToolCalls).toHaveLength(1);
    expect(planned.plannedToolCalls[0].toolName).toBe('memory_search');
  });

  it('can reference a recoverable job without replacing durable job truth', () => {
    const withJob = attachTurnActiveJob(createTurnRuntimeState({
      turnId: 'turn-3',
      sessionId: 'session-1',
      userMessage: 'Generate a four-frame weather sequence.'
    }), {
      jobId: 'job-123',
      now: 300
    });

    expect(withJob.status).toBe('waiting_on_job');
    expect(withJob.activeJobId).toBe('job-123');
    expect(withJob.id).toBe('turn-3');
  });

  it('captures terminal turn failures without requiring an AgentJob', () => {
    const failed = failTurnRuntimeState(createTurnRuntimeState({
      turnId: 'turn-4',
      sessionId: 'session-2',
      userMessage: 'Call a tool that is unavailable.'
    }), {
      error: 'Tool unavailable',
      errorType: 'tool_error',
      now: 440
    });

    expect(failed.status).toBe('failed');
    expect(failed.error).toMatchObject({
      message: 'Tool unavailable',
      type: 'tool_error'
    });
    expect(failed.activeJobId).toBeUndefined();
  });
});
