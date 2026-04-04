import { describe, expect, it, vi } from 'vitest';
import { executeAppSubmitUserTurn } from '../services/appSubmitTurnRuntime';

describe('appSubmitTurnRuntime', () => {
  it('executes the compat submit-turn streaming payload', async () => {
    const executeStreamingTurn = vi.fn().mockResolvedValue(undefined);

    const result = await executeAppSubmitUserTurn({
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
        executeStreamingTurn,
        sendingProjectId: 'project-1',
        userMessage: {
          role: 'user',
          content: 'hello',
          timestamp: 1
        }
      }
    } as any);

    expect(executeStreamingTurn).toHaveBeenCalledWith({
      sendingProjectId: 'project-1',
      userMessage: {
        role: 'user',
        content: 'hello',
        timestamp: 1
      }
    });
    expect(result).toBeUndefined();
  });
});
