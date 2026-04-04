import { describe, expect, it, vi } from 'vitest';
import { updateChatRollingSummary } from '../services/chatSummaryRuntime';
import type { ChatMessage } from '../types';

describe('chatSummaryRuntime', () => {
  it('builds summary source slice from final assistant text and emits updated cursor', async () => {
    const onUpdateContext = vi.fn();
    const summarize = vi.fn().mockResolvedValue('updated summary');
    const history: ChatMessage[] = [
      { role: 'user', content: 'hello', timestamp: 1 },
      { role: 'model', content: 'reply', timestamp: 2 }
    ];

    await updateChatRollingSummary({
      onUpdateContext,
      nextSummaryRange: { from: 0, to: 2 },
      effectiveSummary: 'old summary',
      history,
      fullText: 'final streamed answer',
      summarizeConversation: summarize
    });

    expect(summarize).toHaveBeenCalled();
    expect(onUpdateContext).toHaveBeenCalledWith('updated summary', 2);
  });
});
