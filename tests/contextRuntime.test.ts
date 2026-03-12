import { describe, expect, it } from 'vitest';
import { compactConversationContext, serializeMessagesForSummary } from '../services/contextRuntime';
import { ChatMessage } from '../types';

const makeMessage = (overrides: Partial<ChatMessage>): ChatMessage => ({
  role: 'user',
  content: '',
  timestamp: Date.now(),
  ...overrides
});

describe('contextRuntime helpers', () => {
  it('should keep all unsummarized messages when history fits inside the recent window', () => {
    const history = [
      makeMessage({ role: 'user', content: 'first', timestamp: 1 }),
      makeMessage({ role: 'model', content: 'second', timestamp: 2 }),
      makeMessage({ role: 'user', content: 'third', timestamp: 3 })
    ];

    const compacted = compactConversationContext(history, 'Older summary', 1, 4);

    expect(compacted.effectiveSummary).toBe('Older summary');
    expect(compacted.recentHistory).toHaveLength(2);
    expect(compacted.recentHistory[0].content).toBe('second');
    expect(compacted.nextSummaryRange).toBeUndefined();
  });

  it('should return a summary range when unsummarized history exceeds the recent window', () => {
    const history = Array.from({ length: 10 }, (_, index) =>
      makeMessage({
        role: index % 2 === 0 ? 'user' : 'model',
        content: `message-${index + 1}`,
        timestamp: index + 1
      })
    );

    const compacted = compactConversationContext(history, 'Existing summary', 0, 4);

    expect(compacted.effectiveSummary).toBe('Existing summary');
    expect(compacted.recentHistory).toHaveLength(4);
    expect(compacted.recentHistory[0].content).toBe('message-7');
    expect(compacted.nextSummaryRange).toEqual({ from: 0, to: 6 });
  });

  it('should serialize messages with image counts and sanitized content', () => {
    const serialized = serializeMessagesForSummary([
      makeMessage({
        role: 'user',
        content: 'Please keep this composition',
        timestamp: 1,
        images: ['data:image/png;base64,abc']
      }),
      makeMessage({
        role: 'model',
        content: '[SYSTEM_FEEDBACK]: hidden\nI can refine this next.',
        timestamp: 2
      })
    ]);

    expect(serialized).toContain('User: [images:1] Please keep this composition');
    expect(serialized).toContain('Assistant: I can refine this next.');
    expect(serialized).not.toContain('SYSTEM_FEEDBACK');
  });
});
