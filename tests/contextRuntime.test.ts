import { describe, expect, it } from 'vitest';
import { CONTEXT_LAYER_ROLES, compactConversationContext, serializeMessagesForSummary } from '../services/contextRuntime';
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

    expect(compacted.effectiveSummary).toBe('');
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

  it('should not inject legacy summary text when the summary cursor does not cover any history', () => {
    const history = [
      makeMessage({ role: 'user', content: 'keep this product shot', timestamp: 1 }),
      makeMessage({ role: 'model', content: 'I can refine the bottle texture.', timestamp: 2 })
    ];

    const compacted = compactConversationContext(history, 'Old stale summary', 0, 6);

    expect(compacted.effectiveSummary).toBe('');
    expect(compacted.recentHistory).toHaveLength(2);
  });

  it('should expose explicit source-of-truth layer roles', () => {
    expect(CONTEXT_LAYER_ROLES.transcript).toContain('Recent verbatim');
    expect(CONTEXT_LAYER_ROLES.artifacts).toContain('Authoritative runtime records');
    expect(CONTEXT_LAYER_ROLES.memory).toContain('Durable user and project preferences');
  });

  it('should preserve the latest image-bearing turn inside the compacted recent history window', () => {
    const history = Array.from({ length: 9 }, (_, index) =>
      makeMessage({
        role: index % 2 === 0 ? 'user' : 'model',
        content: `message-${index + 1}`,
        timestamp: index + 1,
        images: index === 8 ? ['data:image/png;base64,latest-ref'] : undefined
      })
    );

    const compacted = compactConversationContext(history, 'Older context', 0, 4);
    const latestRecentMessage = compacted.recentHistory[compacted.recentHistory.length - 1];

    expect(compacted.nextSummaryRange).toEqual({ from: 0, to: 5 });
    expect(latestRecentMessage.images).toEqual(['data:image/png;base64,latest-ref']);
  });
});
