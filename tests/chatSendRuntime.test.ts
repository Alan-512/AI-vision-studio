import { describe, expect, it, vi } from 'vitest';
import { AppMode, ImageModel, TextModel, type ChatMessage } from '../types';
import { executeChatSendFlow } from '../services/chatSendRuntime';

describe('chatSendRuntime', () => {
  it('returns early when nothing can be sent or loading is active', async () => {
    const executeStreamingTurn = vi.fn();

    await executeChatSendFlow({
      customText: '',
      input: '',
      selectedImages: [],
      isLoading: false,
      history: [],
      projectId: 'project-1',
      projectIdRef: { current: 'project-1' },
      selectedModel: TextModel.FLASH,
      mode: AppMode.IMAGE,
      useSearch: false,
      params: { prompt: 'hi' } as any,
      abortControllerRef: { current: null },
      thinkingTextRef: { current: '' },
      searchProgressRef: { current: null },
      setHistory: vi.fn(),
      setInput: vi.fn(),
      setSelectedImages: vi.fn(),
      setIsLoading: vi.fn(),
      setThinkingText: vi.fn(),
      setSearchProgress: vi.fn(),
      setSearchIsCollapsed: vi.fn(),
      clearInputHeight: vi.fn(),
      clearContextAssets: vi.fn(),
      clearThoughtImages: vi.fn(),
      handleToolCallWithRetry: vi.fn(),
      appendThoughtImage: vi.fn(),
      executeStreamingTurn,
      onUpdateProjectContext: vi.fn()
    });

    expect(executeStreamingTurn).not.toHaveBeenCalled();
  });

  it('runs the streaming flow and finalizes the model message', async () => {
    let storedHistory: ChatMessage[] = [{ role: 'user', content: 'older', timestamp: 1 }];
    const setHistory = vi.fn((updater: any) => {
      storedHistory = typeof updater === 'function' ? updater(storedHistory) : updater;
    });
    const setInput = vi.fn();
    const setSelectedImages = vi.fn();
    const setIsLoading = vi.fn();
    const setThinkingText = vi.fn();
    const setSearchProgress = vi.fn();
    const setSearchIsCollapsed = vi.fn();
    const appendThoughtImage = vi.fn();
    const executeStreamingTurn = vi.fn().mockImplementation(async ({ appendModelPlaceholder, onChunk, onThinkingText, onSearchProgress, onFinish }: any) => {
      appendModelPlaceholder();
      onChunk('answer');
      onThinkingText('reasoning');
      onSearchProgress({ status: 'complete' });
      onFinish({ collectedSignatures: [{ partIndex: 0, signature: 'sig-1' }] });
    });

    await executeChatSendFlow({
      customText: 'hello',
      input: '',
      selectedImages: [],
      isLoading: false,
      history: storedHistory,
      projectId: 'project-1',
      projectIdRef: { current: 'project-1' },
      selectedModel: TextModel.FLASH,
      mode: AppMode.IMAGE,
      useSearch: true,
      params: {
        prompt: 'hello',
        imageModel: ImageModel.FLASH_3_1
      } as any,
      abortControllerRef: { current: null },
      thinkingTextRef: { current: '' },
      searchProgressRef: { current: null },
      setHistory,
      setInput,
      setSelectedImages,
      setIsLoading,
      setThinkingText,
      setSearchProgress,
      setSearchIsCollapsed,
      clearInputHeight: vi.fn(),
      clearContextAssets: vi.fn(),
      clearThoughtImages: vi.fn(),
      handleToolCallWithRetry: vi.fn(),
      appendThoughtImage,
      executeStreamingTurn,
      onUpdateProjectContext: vi.fn()
    });

    expect(setInput).toHaveBeenCalledWith('');
    expect(setSelectedImages).toHaveBeenCalledWith([]);
    expect(setIsLoading).toHaveBeenCalledWith(true);
    expect(setIsLoading).toHaveBeenLastCalledWith(false);
    expect(storedHistory[storedHistory.length - 1]).toMatchObject({
      role: 'model',
      content: 'answer',
      isThinking: false,
      thinkingContent: 'reasoning',
      thoughtSignatures: [{ partIndex: 0, signature: 'sig-1' }],
      searchProgress: { status: 'complete' }
    });
  });

  it('dispatches SubmitUserTurn through kernel when a dispatcher is provided', async () => {
    const dispatchKernelCommand = vi.fn().mockResolvedValue({
      turnOutput: {
        streamed: true
      }
    });
    const executeStreamingTurn = vi.fn();

    const result = await executeChatSendFlow({
      customText: 'hello',
      input: '',
      selectedImages: [],
      isLoading: false,
      history: [],
      projectId: 'project-1',
      projectIdRef: { current: 'project-1' },
      selectedModel: TextModel.FLASH,
      mode: AppMode.IMAGE,
      useSearch: true,
      params: {
        prompt: 'hello',
        imageModel: ImageModel.FLASH_3_1
      } as any,
      abortControllerRef: { current: null },
      thinkingTextRef: { current: '' },
      searchProgressRef: { current: null },
      setHistory: vi.fn(),
      setInput: vi.fn(),
      setSelectedImages: vi.fn(),
      setIsLoading: vi.fn(),
      setThinkingText: vi.fn(),
      setSearchProgress: vi.fn(),
      setSearchIsCollapsed: vi.fn(),
      clearInputHeight: vi.fn(),
      clearContextAssets: vi.fn(),
      clearThoughtImages: vi.fn(),
      handleToolCallWithRetry: vi.fn(),
      appendThoughtImage: vi.fn(),
      executeStreamingTurn,
      onUpdateProjectContext: vi.fn(),
      dispatchKernelCommand,
      createId: () => 'turn-submit'
    });

    expect(dispatchKernelCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SubmitUserTurn',
      turn: expect.objectContaining({
        id: 'turn-submit',
        sessionId: 'project-1',
        userMessage: 'hello'
      })
    }));
    expect(executeStreamingTurn).not.toHaveBeenCalled();
    expect(result).toEqual({
      streamed: true
    });
  });
});
