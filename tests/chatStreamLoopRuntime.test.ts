import { describe, expect, it, vi } from 'vitest';
import { executeChatStreamLoop } from '../services/chatStreamLoopRuntime';

describe('chatStreamLoopRuntime', () => {
  it('collects visible text, sources, thought signatures, thought images, and deferred tool calls', async () => {
    const onChunk = vi.fn();
    const onThoughtText = vi.fn();
    const onThoughtImage = vi.fn();

    const result = await executeChatStreamLoop({
      result: (async function* () {
        yield {
          candidates: [{
            content: {
              parts: [
                { text: 'visible text ' },
                { text: 'internal note', thought: true, thoughtSignature: 'sig-thought' },
                { inlineData: { mimeType: 'image/png', data: 'abc' }, thought: true, thoughtSignature: 'sig-image' },
                { functionCall: { name: 'generate_image', args: { prompt: 'poster' } } }
              ]
            }
          }],
          groundingMetadata: {
            groundingChunks: [{ web: { title: 'Source 1', uri: 'https://example.com/1' } }]
          }
        };
        yield {
          text: 'more text',
          candidates: [{
            content: {
              parts: [{ text: 'more text' }]
            }
          }]
        };
      })(),
      signal: new AbortController().signal,
      onChunk,
      onThoughtText,
      onThoughtImage,
      normalizeToolName: name => name === 'generate_image' ? name : null,
      stripVisiblePlanningText: text => text
    });

    expect(result.fullText).toContain('visible text ');
    expect(result.sourcesList).toEqual([{ title: 'Source 1', uri: 'https://example.com/1' }]);
    expect(result.collectedSignatures).toEqual([
      { partIndex: -1, signature: 'sig-thought' },
      { partIndex: 2, signature: 'sig-image' }
    ]);
    expect(result.pendingToolCalls).toEqual([
      { toolName: 'generate_image', args: { prompt: 'poster' } }
    ]);
    expect(result.assistantTurnParts).toEqual(expect.arrayContaining([
      { text: 'visible text ', thoughtSignature: undefined },
      { text: 'internal note', thought: true, thoughtSignature: 'sig-thought' },
      { functionCall: { name: 'generate_image', args: { prompt: 'poster' } }, thoughtSignature: undefined }
    ]));
    expect(onChunk).toHaveBeenCalled();
    expect(onThoughtText).toHaveBeenCalledWith('internal note');
    expect(onThoughtImage).toHaveBeenCalledWith({
      data: 'abc',
      mimeType: 'image/png',
      isFinal: false
    });
  });
});
