import { describe, expect, it, vi } from 'vitest';
import type { ToolCallRecord, ChatMessage } from '../types';
import {
  applyChatActionCard,
  dismissChatActionCard,
  finalizeChatStreamingTurn,
  stopChatStreaming
} from '../services/chatSurfaceRuntime';

describe('chatSurfaceRuntime', () => {
  it('aborts the active stream and clears thinking state on stop', () => {
    const abort = vi.fn();
    const setIsLoading = vi.fn();
    const setHistory = vi.fn((updater: (history: ChatMessage[]) => ChatMessage[]) => {
      const result = updater([
        { role: 'user', content: 'hi', timestamp: 1 },
        { role: 'model', content: '', timestamp: 2, isThinking: true }
      ]);
      expect(result[result.length - 1].isThinking).toBe(false);
    });
    const abortControllerRef = { current: { abort } as unknown as AbortController | null };

    stopChatStreaming({
      abortControllerRef,
      setIsLoading,
      setHistory
    });

    expect(abort).toHaveBeenCalledTimes(1);
    expect(abortControllerRef.current).toBeNull();
    expect(setIsLoading).toHaveBeenCalledWith(false);
    expect(setHistory).toHaveBeenCalledTimes(1);
  });

  it('persists final thinking/search state when the project still matches', () => {
    const setIsLoading = vi.fn();
    const setHistory = vi.fn((updater: (history: ChatMessage[]) => ChatMessage[]) => {
      const result = updater([
        { role: 'user', content: 'hi', timestamp: 1 },
        { role: 'model', content: 'done', timestamp: 2, isThinking: true }
      ]);
      expect(result[result.length - 1]).toMatchObject({
        isThinking: false,
        thinkingContent: 'analysis',
        thoughtSignatures: [{ partIndex: 0, signature: 'sig' }],
        searchProgress: { status: 'complete' }
      });
    });

    finalizeChatStreamingTurn({
      sendingProjectId: 'project-a',
      projectIdRef: { current: 'project-a' },
      abortControllerRef: { current: new AbortController() },
      setIsLoading,
      setHistory,
      thinkingTextRef: { current: 'analysis' },
      searchProgressRef: { current: { status: 'complete' } as any },
      collectedSignatures: [{ partIndex: 0, signature: 'sig' }]
    });

    expect(setIsLoading).toHaveBeenCalledWith(false);
    expect(setHistory).toHaveBeenCalledTimes(1);
  });

  it('dismisses an action card optimistically and rolls back on failure', async () => {
    const toolCall: ToolCallRecord = {
      id: 'tc-1',
      toolName: 'generate_image',
      args: {},
      status: 'completed'
    };
    const previousHistory: ChatMessage[] = [{
      role: 'model',
      content: 'previous',
      timestamp: 1,
      toolCalls: [toolCall]
    }];
    const setHistory = vi.fn();
    const setDismissedActionCardIds = vi.fn();
    const onKeepCurrentAction = vi.fn().mockRejectedValue(new Error('failed'));

    await dismissChatActionCard({
      toolCall,
      history: previousHistory,
      setHistory,
      setDismissedActionCardIds,
      onKeepCurrentAction
    });

    expect(onKeepCurrentAction).toHaveBeenCalledWith(toolCall);
    expect(setHistory).toHaveBeenCalledTimes(2);
    expect(setHistory.mock.calls[1][0]).toBe(previousHistory);
  });

  it('applies an action card with optimistic system message and rollback on failure', async () => {
    const toolCall: ToolCallRecord = {
      id: 'tc-1',
      toolName: 'generate_image',
      args: { prompt: 'old prompt' },
      status: 'requires_action',
      result: {
        status: 'requires_action',
        jobId: 'job-1',
        requiresAction: {
          type: 'refine_prompt',
          payload: {
            revisedPrompt: 'new prompt'
          }
        }
      } as any
    };
    const setHistory = vi.fn();
    const setDismissedActionCardIds = vi.fn();
    const setApplyingActionCardId = vi.fn();
    const handleToolCallWithRetry = vi.fn().mockRejectedValue(new Error('retry failed'));

    await applyChatActionCard({
      toolCall,
      language: 'en',
      setHistory,
      setDismissedActionCardIds,
      setApplyingActionCardId,
      handleToolCallWithRetry
    });

    expect(handleToolCallWithRetry).toHaveBeenCalledWith({
      toolName: 'generate_image',
      args: expect.objectContaining({
        prompt: 'new prompt',
        resume_job_id: 'job-1',
        requires_action_type: 'refine_prompt'
      })
    });
    expect(setHistory).toHaveBeenCalledTimes(2);
    expect(setApplyingActionCardId).toHaveBeenLastCalledWith(expect.any(Function));
  });
});
