import { describe, expect, it, vi } from 'vitest';
import { executeDeferredChatToolCalls } from '../services/chatDeferredToolRuntime';

describe('chatDeferredToolRuntime', () => {
  it('injects search facts into deferred tool prompts and forwards external tool calls', async () => {
    const onChunk = vi.fn();
    const onToolCall = vi.fn();

    const result = await executeDeferredChatToolCalls({
      pendingToolCalls: [{ toolName: 'generate_image', args: {} }],
      assistantTurnParts: [{ text: 'draft answer' }],
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }] as any,
      signal: new AbortController().signal,
      fullText: 'draft answer',
      onChunk,
      onToolCall,
      searchFacts: [{ item: 'Brand', source: 'Blue can' }],
      searchPromptDraft: 'Blue can poster',
      userMessage: 'make a poster',
      projectId: 'project-1',
      runInternalToolResultLoopImpl: vi.fn().mockResolvedValue({
        fullText: 'draft answer',
        workingContents: [],
        externalToolCalls: [{ toolName: 'generate_image', args: { prompt: 'Blue can poster\n\nRelevant facts to incorporate:\n- Brand: Blue can', useGrounding: false } }]
      }),
      executeInternalToolCallImpl: vi.fn(),
      generateFollowUpParts: vi.fn()
    });

    expect(result.fullText).toBe('draft answer');
    expect(onToolCall).toHaveBeenCalledWith({
      toolName: 'generate_image',
      args: {
        prompt: 'Blue can poster\n\nRelevant facts to incorporate:\n- Brand: Blue can',
        useGrounding: false
      }
    });
  });

  it('annotates multiple generate_image tool calls as separate frame intents', async () => {
    const onToolCall = vi.fn();

    await executeDeferredChatToolCalls({
      pendingToolCalls: [
        { toolName: 'generate_image', args: { prompt: 'frame one' } },
        { toolName: 'generate_image', args: { prompt: 'frame two' } }
      ],
      assistantTurnParts: [],
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }] as any,
      signal: new AbortController().signal,
      fullText: '',
      onChunk: vi.fn(),
      onToolCall,
      searchFacts: [],
      searchPromptDraft: '',
      userMessage: 'make four separate frames',
      projectId: 'project-1',
      runInternalToolResultLoopImpl: vi.fn().mockResolvedValue({
        fullText: '',
        workingContents: [],
        externalToolCalls: [
          { toolName: 'generate_image', args: { prompt: 'frame one', sequence_intent: 'separate_frames', frame_index: 0, frame_total: 2 } },
          { toolName: 'generate_image', args: { prompt: 'frame two', sequence_intent: 'separate_frames', frame_index: 1, frame_total: 2 } }
        ]
      }),
      executeInternalToolCallImpl: vi.fn(),
      generateFollowUpParts: vi.fn()
    });

    expect(onToolCall).toHaveBeenNthCalledWith(1, {
      toolName: 'generate_image',
      args: expect.objectContaining({
        prompt: 'frame one',
        sequence_intent: 'separate_frames',
        frame_index: 0,
        frame_total: 2
      })
    });
    expect(onToolCall).toHaveBeenNthCalledWith(2, {
      toolName: 'generate_image',
      args: expect.objectContaining({
        prompt: 'frame two',
        sequence_intent: 'separate_frames',
        frame_index: 1,
        frame_total: 2
      })
    });
  });
});
