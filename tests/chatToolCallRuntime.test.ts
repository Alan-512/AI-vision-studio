import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types';
import {
  resolveActiveToolCallMessageTimestamp,
  shouldShowActiveToolCallForMessage
} from '../services/chatToolCallRuntime';

describe('chatToolCallRuntime', () => {
  it('pins an active tool call to the model message that started it', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'make an image', timestamp: 100 },
      { role: 'model', content: '', timestamp: 200, isThinking: true },
      { role: 'user', content: 'follow-up question', timestamp: 300 },
      { role: 'model', content: '', timestamp: 400, isThinking: true }
    ];

    expect(resolveActiveToolCallMessageTimestamp(history)).toBe(400);
  });

  it('does not show a previous active generation card on a newer ai reply', () => {
    const sourceMessage: ChatMessage = { role: 'model', content: '', timestamp: 200, isThinking: true };
    const newerMessage: ChatMessage = { role: 'model', content: '', timestamp: 400, isThinking: true };

    const activeToolCall = {
      isActive: true,
      toolName: 'generate_image',
      model: 'Nano Banana 2',
      prompt: 'weather anchor portrait',
      sourceMessageTimestamp: 200
    };

    expect(shouldShowActiveToolCallForMessage(activeToolCall, sourceMessage, false)).toBe(true);
    expect(shouldShowActiveToolCallForMessage(activeToolCall, newerMessage, false)).toBe(false);
  });

  it('suppresses the active generation card once preview feedback is available for that message', () => {
    const sourceMessage: ChatMessage = { role: 'model', content: '', timestamp: 200, isThinking: true };
    const activeToolCall = {
      isActive: true,
      toolName: 'generate_image',
      model: 'Nano Banana 2',
      prompt: 'weather anchor portrait',
      sourceMessageTimestamp: 200
    };

    expect(shouldShowActiveToolCallForMessage(activeToolCall, sourceMessage, true)).toBe(false);
  });
});
