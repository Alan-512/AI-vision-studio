import { describe, expect, it, vi } from 'vitest';
import { AppMode, ImageModel, TextModel } from '../types';
import { buildSubmitUserTurnCommand } from '../services/chatSubmitTurnRuntime';

describe('chatSubmitTurnRuntime', () => {
  it('builds a submit-turn command with a surface binding key instead of inline callbacks', () => {
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
      surfaceBindingKey: 'turn-1'
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
          surfaceBindingKey: 'turn-1',
          userMessage: expect.objectContaining({
            content: 'hello'
          })
        })
      }
    });
    expect((command.payload as any).input.appendModelPlaceholder).toBeUndefined();
    expect((command.payload as any).input.onChunk).toBeUndefined();
    expect((command.payload as any).input.onFinish).toBeUndefined();
    expect((command.payload as any).input.projectIdRef).toBeUndefined();
    expect((command.payload as any).input.handleToolCallWithRetry).toBeUndefined();
    expect((command.payload as any).input.signal).toBeUndefined();
  });
});
