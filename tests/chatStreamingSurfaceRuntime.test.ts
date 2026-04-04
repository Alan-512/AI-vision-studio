import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../types';
import { createChatStreamingSurfaceCallbacks } from '../services/chatStreamingSurfaceRuntime';

describe('chatStreamingSurfaceRuntime', () => {
  it('updates thinking and search progress refs while collecting signatures', () => {
    let history: ChatMessage[] = [
      { role: 'user', content: 'hi', timestamp: 1 },
      { role: 'model', content: '', timestamp: 2, isThinking: true }
    ];
    const setHistory = vi.fn((updater: any) => {
      history = typeof updater === 'function' ? updater(history) : updater;
    });
    const setThinkingText = vi.fn();
    const setSearchProgress = vi.fn();
    const setSearchIsCollapsed = vi.fn();
    const thinkingTextRef = { current: '' };
    const searchProgressRef = { current: null as any };
    let collectedSignatures: Array<{ partIndex: number; signature: string }> = [];

    const callbacks = createChatStreamingSurfaceCallbacks({
      sendingProjectId: 'project-1',
      projectIdRef: { current: 'project-1' },
      setHistory,
      setThinkingText,
      thinkingTextRef,
      setSearchProgress,
      searchProgressRef,
      setSearchIsCollapsed,
      onCollectedSignatures: signatures => {
        collectedSignatures = signatures;
      }
    });

    callbacks.appendModelPlaceholder();
    callbacks.onChunk('answer');
    callbacks.onThinkingText('reasoning');
    callbacks.onSearchProgress({ status: 'complete' });
    callbacks.onFinish({
      collectedSignatures: [{ partIndex: 0, signature: 'sig-1' }]
    });

    expect(history[history.length - 1]).toMatchObject({
      role: 'model',
      content: 'answer'
    });
    expect(thinkingTextRef.current).toBe('reasoning');
    expect(setThinkingText).toHaveBeenCalled();
    expect(searchProgressRef.current).toEqual({ status: 'complete' });
    expect(setSearchProgress).toHaveBeenCalledWith({ status: 'complete' });
    expect(collectedSignatures).toEqual([{ partIndex: 0, signature: 'sig-1' }]);
  });
});
