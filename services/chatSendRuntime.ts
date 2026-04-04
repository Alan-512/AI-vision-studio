import type { Dispatch, SetStateAction } from 'react';
import type { AgentAction, ChatMessage, GenerationParams, SearchProgress, SmartAsset, TextModel } from '../types';
import type { KernelTransitionResult, SubmitUserTurnCommand } from './agentKernelTypes';
import { buildSubmitUserTurnCommand } from './chatSubmitTurnRuntime';
import { createChatStreamingSurfaceCallbacks } from './chatStreamingSurfaceRuntime';
import {
  clearStreamingTurnSurfaceBindings,
  registerStreamingTurnSurfaceBindings
} from './streamingTurnSurfaceBindingRuntime';
import { buildOutgoingChatMessage, executeChatStreamingTurn } from './chatStreamingRuntime';
import { finalizeChatStreamingTurn } from './chatSurfaceRuntime';

export const executeChatSendFlow = async ({
  customText,
  input,
  selectedImages,
  isLoading,
  history,
  projectId,
  projectIdRef,
  selectedModel,
  mode,
  projectContextSummary,
  projectSummaryCursor,
  onUpdateProjectContext,
  handleToolCallWithRetry,
  useSearch,
  params,
  agentContextAssets,
  abortControllerRef,
  thinkingTextRef,
  searchProgressRef,
  setHistory,
  setInput,
  setSelectedImages,
  setIsLoading,
  setThinkingText,
  setSearchProgress,
  setSearchIsCollapsed,
  clearInputHeight,
  clearContextAssets,
  clearThoughtImages,
  appendThoughtImage,
  dispatchKernelCommand,
  createId = () => crypto.randomUUID(),
  executeStreamingTurn = executeChatStreamingTurn
}: {
  customText?: string;
  input: string;
  selectedImages: string[];
  isLoading: boolean;
  history: ChatMessage[];
  projectId: string;
  projectIdRef: { current: string };
  selectedModel: TextModel;
  mode: any;
  projectContextSummary?: string;
  projectSummaryCursor?: number;
  onUpdateProjectContext?: (summary: string, cursor: number) => void;
  handleToolCallWithRetry: (action: AgentAction) => Promise<void>;
  useSearch: boolean;
  params: GenerationParams;
  agentContextAssets?: SmartAsset[];
  abortControllerRef: { current: AbortController | null };
  thinkingTextRef: { current: string };
  searchProgressRef: { current: SearchProgress | null };
  setHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  setInput: (value: string) => void;
  setSelectedImages: (value: string[]) => void;
  setIsLoading: (value: boolean) => void;
  setThinkingText: Dispatch<SetStateAction<string>>;
  setSearchProgress: Dispatch<SetStateAction<SearchProgress | null>>;
  setSearchIsCollapsed: (value: boolean) => void;
  clearInputHeight: () => void;
  clearContextAssets?: () => void;
  clearThoughtImages?: () => void;
  appendThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void;
  dispatchKernelCommand?: (command: SubmitUserTurnCommand) => Promise<Pick<KernelTransitionResult, 'turnOutput'>>;
  createId?: () => string;
  executeStreamingTurn?: typeof executeChatStreamingTurn;
}) => {
  const textToSend = customText || input.trim();
  console.log('[Chat] handleSend called, isLoading:', isLoading, 'text:', textToSend?.slice(0, 30));
  if ((!textToSend && selectedImages.length === 0) || isLoading) {
    console.log('[Chat] Message blocked - early return');
    return;
  }

  const sendingProjectId = projectId;
  const { userMessage, nextHistory } = buildOutgoingChatMessage({
    content: textToSend,
    history,
    selectedImages,
    agentContextAssets
  });

  setHistory(nextHistory);
  setInput('');
  clearInputHeight();
  setSelectedImages([]);
  clearContextAssets?.();
  clearThoughtImages?.();
  setIsLoading(true);

  const abortController = new AbortController();
  abortControllerRef.current = abortController;
  let collectedSignatures: Array<{ partIndex: number; signature: string }> = [];
  const streamingCallbacks = createChatStreamingSurfaceCallbacks({
    sendingProjectId,
    projectIdRef,
    setHistory,
    setThinkingText,
    thinkingTextRef,
    setSearchProgress,
    searchProgressRef,
    setSearchIsCollapsed,
    onCollectedSignatures: finalSignatures => {
      collectedSignatures = finalSignatures;
    }
  });

  try {
    setThinkingText('');
    thinkingTextRef.current = '';
    setSearchProgress(null);
    searchProgressRef.current = null;
    setSearchIsCollapsed(false);

    if (dispatchKernelCommand) {
      const command = buildSubmitUserTurnCommand({
        createId,
        sendingProjectId,
        projectIdRef,
        nextHistory,
        userMessage,
        selectedModel,
        mode,
        projectContextSummary,
        projectSummaryCursor,
        onUpdateProjectContext,
        handleToolCallWithRetry,
        useSearch,
        params,
        agentContextAssets,
        signal: abortController.signal
      });
      const surfaceBindingKey = command.payload?.input.surfaceBindingKey;
      if (surfaceBindingKey) {
        registerStreamingTurnSurfaceBindings(surfaceBindingKey, {
          projectIdRef,
          onUpdateProjectContext,
          handleToolCallWithRetry,
          signal: abortController.signal,
          appendModelPlaceholder: streamingCallbacks.appendModelPlaceholder,
          onChunk: streamingCallbacks.onChunk,
          onThoughtImage: appendThoughtImage,
          onThinkingText: streamingCallbacks.onThinkingText,
          onSearchProgress: streamingCallbacks.onSearchProgress,
          onStreamError: streamingCallbacks.onStreamError,
          onFinish: ({ collectedSignatures: finalSignatures }) => {
            streamingCallbacks.onFinish({ collectedSignatures: finalSignatures });
            collectedSignatures = finalSignatures;
          }
        });
      }
      try {
        const result = await dispatchKernelCommand(command);
        return result.turnOutput;
      } finally {
        if (surfaceBindingKey) {
          clearStreamingTurnSurfaceBindings(surfaceBindingKey);
        }
      }
    }

    await executeStreamingTurn({
      sendingProjectId,
      projectIdRef,
      newHistory: nextHistory,
      userMessage,
      selectedModel,
      mode,
      projectContextSummary,
      projectSummaryCursor,
      onUpdateProjectContext,
      handleToolCallWithRetry,
      useSearch,
      params,
      agentContextAssets,
      signal: abortController.signal,
      appendModelPlaceholder: streamingCallbacks.appendModelPlaceholder,
      onChunk: streamingCallbacks.onChunk,
      onThoughtImage: appendThoughtImage,
      onThinkingText: streamingCallbacks.onThinkingText,
      onSearchProgress: streamingCallbacks.onSearchProgress,
      onStreamError: streamingCallbacks.onStreamError,
      onFinish: ({ collectedSignatures: finalSignatures }) => {
        streamingCallbacks.onFinish({ collectedSignatures: finalSignatures });
      }
    });
  } finally {
    finalizeChatStreamingTurn({
      sendingProjectId,
      projectIdRef,
      abortControllerRef,
      setIsLoading,
      setHistory,
      thinkingTextRef,
      searchProgressRef,
      collectedSignatures
    });
  }
};
