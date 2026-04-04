import { describe, expect, it, vi } from 'vitest';
import { executeAppSubmitUserTurn } from '../services/appSubmitTurnRuntime';

describe('appSubmitTurnRuntime', () => {
  it('executes the compat submit-turn streaming payload with resolved surface bindings', async () => {
    const executeStreamingTurn = vi.fn().mockResolvedValue(undefined);
    const resolveSurfaceBindings = vi.fn().mockReturnValue({
      projectIdRef: { current: 'project-1' },
      onUpdateProjectContext: vi.fn(),
      handleToolCallWithRetry: vi.fn(),
      signal: new AbortController().signal,
      appendModelPlaceholder: vi.fn(),
      onChunk: vi.fn(),
      onThinkingText: vi.fn(),
      onSearchProgress: vi.fn(),
      onStreamError: vi.fn(),
      onFinish: vi.fn()
    });

    const result = await executeAppSubmitUserTurn({
      payload: {
        kind: 'streaming_turn',
        input: {
          sendingProjectId: 'project-1',
          surfaceBindingKey: 'turn-1',
          userMessage: {
            role: 'user',
            content: 'hello',
            timestamp: 1
          }
        }
      } as any,
      executeStreamingTurn,
      resolveSurfaceBindings
    });

    expect(resolveSurfaceBindings).toHaveBeenCalledWith('turn-1');
    expect(executeStreamingTurn).toHaveBeenCalledWith({
      sendingProjectId: 'project-1',
      surfaceBindingKey: 'turn-1',
      userMessage: {
        role: 'user',
        content: 'hello',
        timestamp: 1
      },
      projectIdRef: { current: 'project-1' },
      onUpdateProjectContext: expect.any(Function),
      handleToolCallWithRetry: expect.any(Function),
      signal: expect.any(AbortSignal),
      appendModelPlaceholder: expect.any(Function),
      onChunk: expect.any(Function),
      onThinkingText: expect.any(Function),
      onSearchProgress: expect.any(Function),
      onStreamError: expect.any(Function),
      onFinish: expect.any(Function)
    });
    expect(result).toBeUndefined();
  });

  it('rejects submit-turn payloads when surface bindings are missing', async () => {
    await expect(executeAppSubmitUserTurn({
      payload: {
        kind: 'streaming_turn',
        input: {
          surfaceBindingKey: 'turn-missing'
        }
      } as any,
      executeStreamingTurn: vi.fn(),
      resolveSurfaceBindings: vi.fn().mockReturnValue(undefined)
    })).rejects.toThrow('Missing streaming surface bindings');
  });

  it('rejects submit-turn payloads with an unsupported compat kind', async () => {
    await expect(executeAppSubmitUserTurn({
      payload: {
        kind: 'unknown'
      } as any,
      executeStreamingTurn: vi.fn(),
      resolveSurfaceBindings: vi.fn()
    })).rejects.toThrow('Unsupported submit-turn payload kind');
  });
});
