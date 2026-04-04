import { describe, expect, it, vi } from 'vitest';
import { AppMode, ImageModel, TextModel } from '../types';
import { buildSubmitUserTurnCommand } from '../services/chatSubmitTurnRuntime';

describe('chatSubmitTurnRuntime', () => {
  it('builds a submit-turn command with streaming compat payload', () => {
    let collectedSignatures: Array<{ partIndex: number; signature: string }> = [];
    const streamingCallbacks = {
      appendModelPlaceholder: vi.fn(),
      onChunk: vi.fn(),
      onThinkingText: vi.fn(),
      onSearchProgress: vi.fn(),
      onStreamError: vi.fn(),
      onFinish: vi.fn()
    };

    const command = buildSubmitUserTurnCommand({
      createId: () => 'turn-1',
      sendingProjectId: 'project-1',
      projectIdRef: { current: 'project-1' },
      nextHistory: [],
      userMessage: {
        role: 'user',
        content: 'hello',
        timestamp: 1
      } as any,
      selectedModel: TextModel.FLASH,
      mode: AppMode.IMAGE,
      onUpdateProjectContext: vi.fn(),
      handleToolCallWithRetry: vi.fn(),
      useSearch: true,
      params: { prompt: 'hello', imageModel: ImageModel.FLASH_3_1 } as any,
      agentContextAssets: [],
      signal: new AbortController().signal,
      onThoughtImage: vi.fn(),
      streamingCallbacks: streamingCallbacks as any,
      onCollectedSignatures: signatures => {
        collectedSignatures = signatures;
      }
    });

    expect(command).toMatchObject({
      type: 'SubmitUserTurn',
      turn: expect.objectContaining({
        id: 'turn-1',
        sessionId: 'project-1',
        userMessage: 'hello'
      }),
      payload: {
        kind: 'streaming_turn',
        input: expect.objectContaining({
          sendingProjectId: 'project-1',
          userMessage: expect.objectContaining({
            content: 'hello'
          })
        })
      }
    });

    ((command.payload as any).input as any).onFinish({
      collectedSignatures: [{ partIndex: 0, signature: 'sig-1' }]
    });

    expect(collectedSignatures).toEqual([{ partIndex: 0, signature: 'sig-1' }]);
  });
});
