import { describe, expect, it } from 'vitest';
import {
  normalizeSupportedToolName,
  runInternalToolResultLoop
} from '../services/internalToolRuntime';

describe('internalToolRuntime', () => {
  describe('normalizeSupportedToolName', () => {
    it('normalizes the legacy read_memory alias to memory_search', () => {
      expect(normalizeSupportedToolName('read_memory')).toBe('memory_search');
    });

    it('keeps supported tool names unchanged', () => {
      expect(normalizeSupportedToolName('memory_search')).toBe('memory_search');
      expect(normalizeSupportedToolName('generate_image')).toBe('generate_image');
    });

    it('rejects unsupported tool names', () => {
      expect(normalizeSupportedToolName('unknown_tool')).toBeNull();
    });
  });

  describe('runInternalToolResultLoop', () => {
    it('feeds an internal memory tool result into a same-turn follow-up response', async () => {
      const emittedChunks: string[] = [];
      const result = await runInternalToolResultLoop({
        pendingToolCalls: [{
          toolName: 'memory_search',
          args: { query: 'preferred aspect ratio' }
        }],
        workingContents: [],
        fullText: '',
        signal: new AbortController().signal,
        onChunk: (text) => emittedChunks.push(text),
        executeToolCall: async () => ({
          response: { ok: true, result: 'The user prefers 4:5.' },
          fallbackText: 'The user prefers 4:5.'
        }),
        generateFollowUpParts: async () => ([
          { text: 'I found a stored preference: use a 4:5 aspect ratio.' }
        ])
      });

      expect(result.externalToolCalls).toEqual([]);
      expect(result.fullText).toContain('4:5 aspect ratio');
      expect(emittedChunks[emittedChunks.length - 1]).toContain('4:5 aspect ratio');
    });

    it('enqueues external tool calls emitted after an internal memory lookup', async () => {
      const result = await runInternalToolResultLoop({
        pendingToolCalls: [{
          toolName: 'memory_search',
          args: { query: 'poster style' }
        }],
        workingContents: [],
        fullText: '',
        signal: new AbortController().signal,
        onChunk: () => undefined,
        executeToolCall: async () => ({
          response: { ok: true, result: 'Poster style: minimalist.' }
        }),
        generateFollowUpParts: async () => ([
          {
            functionCall: {
              name: 'generate_image',
              args: { prompt: 'Minimalist poster' }
            }
          }
        ])
      });

      expect(result.externalToolCalls).toEqual([
        {
          toolName: 'generate_image',
          args: { prompt: 'Minimalist poster' }
        }
      ]);
    });
  });
});
