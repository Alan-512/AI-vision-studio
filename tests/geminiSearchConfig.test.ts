import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppMode, TextModel } from '../types';

const genAiMocks = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
  generateContent: vi.fn()
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContentStream: genAiMocks.generateContentStream,
      generateContent: genAiMocks.generateContent
    };
  },
  Type: {
    STRING: 'STRING',
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    BOOLEAN: 'BOOLEAN',
    NUMBER: 'NUMBER'
  }
}));

vi.mock('../services/skills/promptRouter', () => ({
  buildSystemInstruction: vi.fn(() => '[PROJECT CONTEXT]\nTest system prompt'),
  getPromptOptimizerContent: vi.fn(() => ''),
  getRoleInstruction: vi.fn(() => '')
}));

vi.mock('../services/memoryService', () => ({
  getAlwaysOnMemorySnippet: vi.fn(async () => '')
}));

vi.mock('../services/contextRuntime', () => ({
  compactConversationContext: vi.fn((history: any[], summary?: string, cursor?: number) => ({
    effectiveSummary: summary || '',
    recentHistory: history,
    nextSummaryRange: null
  })),
  serializeMessagesForSummary: vi.fn(() => '')
}));

import { streamChatResponse } from '../services/geminiService';

const emptyStream = async function* () {
  yield { candidates: [{ content: { parts: [] } }] };
};

describe('Gemini search tool config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('user_gemini_api_key', 'test-key');
    genAiMocks.generateContentStream.mockImplementation(() => emptyStream());
    genAiMocks.generateContent.mockResolvedValue({ candidates: [{ content: { parts: [] } }] });
  });

  it('uses Flash for the LLM search phase even when Thinking mode is selected', async () => {
    await streamChatResponse(
      [{ role: 'user', content: '生成一张阿凡达3的电影剧照', timestamp: Date.now() }],
      '生成一张阿凡达3的电影剧照',
      () => undefined,
      TextModel.PRO,
      AppMode.IMAGE,
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );

    const firstRequest = genAiMocks.generateContentStream.mock.calls[0]?.[0];
    const secondRequest = genAiMocks.generateContentStream.mock.calls[1]?.[0];

    expect(firstRequest?.model).toBe(TextModel.FLASH);
    expect(firstRequest?.config?.tools).toEqual([{ googleSearch: {} }]);
    expect(secondRequest?.model).toBe(TextModel.PRO);
  });

  it('falls back to the main response when the search phase request fails', async () => {
    genAiMocks.generateContentStream
      .mockRejectedValueOnce(new Error('search phase failed'))
      .mockImplementationOnce(() => emptyStream());

    await expect(streamChatResponse(
      [{ role: 'user', content: '生成一张阿凡达3的电影剧照', timestamp: Date.now() }],
      '生成一张阿凡达3的电影剧照',
      () => undefined,
      TextModel.PRO,
      AppMode.IMAGE,
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    )).resolves.toBeUndefined();

    expect(genAiMocks.generateContentStream).toHaveBeenCalledTimes(2);
  });

  it('falls back to the main response when the search phase hangs', async () => {
    vi.useFakeTimers();
    genAiMocks.generateContentStream
      .mockImplementationOnce(() => new Promise(() => undefined) as any)
      .mockImplementationOnce(() => emptyStream());

    const responsePromise = streamChatResponse(
      [{ role: 'user', content: '生成一张阿凡达3的电影剧照', timestamp: Date.now() }],
      '生成一张阿凡达3的电影剧照',
      () => undefined,
      TextModel.PRO,
      AppMode.IMAGE,
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );

    await vi.advanceTimersByTimeAsync(15000);

    await expect(responsePromise).resolves.toBeUndefined();
    expect(genAiMocks.generateContentStream).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
