import { describe, expect, it, vi } from 'vitest';
import { executeAppSubmitUserTurn } from '../services/appSubmitTurnRuntime';

describe('appSubmitTurnRuntime', () => {
  it('executes the compat submit-turn streaming payload', async () => {
    const executeStreamingTurn = vi.fn().mockResolvedValue(undefined);

    const result = await executeAppSubmitUserTurn({
      payload: {
        kind: 'streaming_turn',
        input: {
          sendingProjectId: 'project-1',
          userMessage: {
            role: 'user',
            content: 'hello',
            timestamp: 1
          }
        }
      } as any,
      executeStreamingTurn
    });

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

  it('rejects submit-turn payloads with an unsupported compat kind', async () => {
    await expect(executeAppSubmitUserTurn({
      payload: {
        kind: 'unknown'
      } as any,
      executeStreamingTurn: vi.fn()
    })).rejects.toThrow('Unsupported submit-turn payload kind');
  });
});
