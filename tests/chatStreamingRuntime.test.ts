import { describe, expect, it, vi } from 'vitest';
import { AppMode, ImageModel, TextModel, type ChatMessage, type SearchProgress, type SmartAsset } from '../types';
import { buildOutgoingChatMessage, executeChatStreamingTurn } from '../services/chatStreamingRuntime';

describe('chatStreamingRuntime', () => {
  it('merges context assets and selected images into the outgoing user message', () => {
    const history: ChatMessage[] = [{ role: 'user', content: 'older', timestamp: 1 }];
    const agentContextAssets: SmartAsset[] = [{
      id: 'ctx-1',
      type: 'image',
      name: 'ctx',
      mimeType: 'image/png',
      data: 'Y3R4',
      thumbnailData: 'Y3R4',
      width: 10,
      height: 10,
      createdAt: 1,
      updatedAt: 1,
      origin: 'user'
    }];

    const result = buildOutgoingChatMessage({
      content: 'make a poster',
      history,
      selectedImages: ['data:image/jpeg;base64,c2VsZWN0ZWQ='],
      agentContextAssets,
      timestamp: 2
    });

    expect(result.nextHistory).toHaveLength(2);
    expect(result.userMessage.images).toEqual([
      'data:image/png;base64,Y3R4',
      'data:image/jpeg;base64,c2VsZWN0ZWQ='
    ]);
  });

  it('streams chunks, thinking text, search progress, and finish callbacks', async () => {
    const appendModelPlaceholder = vi.fn();
    const onChunk = vi.fn();
    const onThinkingText = vi.fn();
    const onSearchProgress = vi.fn();
    const onStreamError = vi.fn();
    const onFinish = vi.fn();
    const handleToolCallWithRetry = vi.fn();
    const progress = { status: 'complete' } as SearchProgress;

    const streamChatResponseImpl = vi.fn().mockImplementation(async (
      _history,
      _prompt,
      onChunkCallback,
      _model,
      _mode,
      _signal,
      _summary,
      _cursor,
      _onUpdate,
      _toolCall,
      _useSearch,
      _params,
      _agentContextAssets,
      onSignatures,
      _onThoughtImage,
      onThinkingTextCallback,
      onSearchProgressCallback
    ) => {
      onChunkCallback('hello');
      onThinkingTextCallback('thinking');
      onSearchProgressCallback(progress);
      onSignatures([{ partIndex: 1, signature: 'sig-1' }]);
    });

    await executeChatStreamingTurn({
      sendingProjectId: 'project-a',
      projectIdRef: { current: 'project-a' },
      newHistory: [{ role: 'user', content: 'hi', timestamp: 1 }],
      userMessage: { role: 'user', content: 'hi', timestamp: 1 },
      selectedModel: TextModel.FLASH,
      mode: AppMode.IMAGE,
      handleToolCallWithRetry,
      useSearch: true,
      params: {
        prompt: 'hi',
        savedImagePrompt: '',
        savedVideoPrompt: '',
        aspectRatio: '1:1' as any,
        imageModel: ImageModel.FLASH_3_1,
        imageStyle: undefined as any,
        imageResolution: '1K' as any,
        videoModel: undefined as any,
        videoStyle: undefined as any,
        videoResolution: undefined as any,
        videoDuration: undefined as any,
        useGrounding: false,
        searchPolicy: undefined as any,
        smartAssets: [],
        isAutoMode: true
      },
      appendModelPlaceholder,
      onChunk,
      onThinkingText,
      onSearchProgress,
      onStreamError,
      onFinish,
      signal: new AbortController().signal,
      streamChatResponseImpl
    });

    expect(appendModelPlaceholder).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('hello');
    expect(onThinkingText).toHaveBeenCalledWith('thinking');
    expect(onSearchProgress).toHaveBeenCalledWith(progress);
    expect(onStreamError).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledWith({
      collectedSignatures: [{ partIndex: 1, signature: 'sig-1' }]
    });
  });
});
