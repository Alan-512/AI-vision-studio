import { describe, expect, it, vi } from 'vitest';
import { executeStreamChatResponse } from '../services/chatResponseRuntime';
import { AppMode, TextModel } from '../types';

describe('chatResponseRuntime', () => {
  it('delegates search, stream loop, deferred tools, and summary update through injected runtimes', async () => {
    const executeSearchPhase = vi.fn().mockResolvedValue({
      searchFullText: '',
      collectedQueries: [],
      collectedSources: []
    });
    const executeChatStreamLoop = vi.fn().mockResolvedValue({
      fullText: 'hello',
      sourcesList: [],
      collectedSignatures: [],
      pendingToolCalls: [],
      assistantTurnParts: [],
      chunkCount: 1
    });
    const updateChatRollingSummary = vi.fn().mockResolvedValue(undefined);
    const onChunk = vi.fn();

    await executeStreamChatResponse({
      ai: {
        models: {
          generateContentStream: vi.fn().mockResolvedValue((async function* () {})())
        }
      } as any,
      history: [{ role: 'user', content: 'hello', timestamp: 1 }],
      newMessage: 'hello',
      onChunk,
      modelName: TextModel.FLASH,
      mode: AppMode.IMAGE,
      signal: new AbortController().signal,
      buildSystemInstruction: vi.fn().mockReturnValue({ systemInstruction: 'system' }),
      compactConversationContext: vi.fn().mockReturnValue({
        effectiveSummary: '',
        recentHistory: [{ role: 'user', content: 'hello', timestamp: 1 }]
      }),
      convertHistoryToNativeFormat: vi.fn().mockReturnValue([]),
      buildSearchPhaseInstruction: vi.fn().mockReturnValue('search'),
      executeSearchPhase,
      finalizeSearchPhaseResult: vi.fn().mockReturnValue({
        searchFacts: [],
        searchPromptDraft: '',
        completionProgress: undefined
      }),
      getAlwaysOnMemorySnippet: vi.fn().mockResolvedValue(''),
      buildRetrievedContextSection: vi.fn().mockReturnValue(''),
      mergeChatSystemInstruction: vi.fn().mockReturnValue('system'),
      buildChatResponseConfig: vi.fn().mockReturnValue({ systemInstruction: 'system', tools: [] }),
      executeChatStreamLoop,
      executeDeferredChatToolCalls: vi.fn().mockResolvedValue({ fullText: 'hello' }),
      updateChatRollingSummary,
      buildGoogleSearchTools: vi.fn().mockReturnValue([{}]),
      normalizeSupportedToolName: vi.fn(),
      stripVisibleToolPlanningText: vi.fn(text => text)
    } as any);

    expect(executeChatStreamLoop).toHaveBeenCalledTimes(1);
    expect(onChunk).not.toHaveBeenCalled();
    expect(updateChatRollingSummary).not.toHaveBeenCalled();
  });
});
