import type { Dispatch, SetStateAction } from 'react';
import type { AgentAction, ChatMessage, GenerationParams, SearchProgress, SmartAsset, TextModel } from '../types';
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

  try {
    setThinkingText('');
    thinkingTextRef.current = '';
    setSearchProgress(null);
    searchProgressRef.current = null;
    setSearchIsCollapsed(false);

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
      appendModelPlaceholder: () => {
        const tempAiMsg: ChatMessage = { role: 'model', content: '', timestamp: Date.now(), isThinking: true };
        setHistory(prev => [...prev, tempAiMsg]);
      },
      onChunk: chunkText => {
        setHistory(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: chunkText };
          return updated;
        });
      },
      onThoughtImage: appendThoughtImage,
      onThinkingText: text => {
        thinkingTextRef.current += text;
        setThinkingText(prev => prev + text);
      },
      onSearchProgress: progress => {
        setSearchProgress(progress);
        searchProgressRef.current = progress;
        if (progress.status === 'complete') {
          setTimeout(() => {
            setSearchIsCollapsed(true);
          }, 2000);
        }
      },
      onStreamError: error => {
        console.error('Chat Error:', error);
        if (projectIdRef.current !== sendingProjectId) return;
        setHistory(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === 'model') {
            const currentContent = updated[lastIdx].content;
            const suppressInlineError = (updated[lastIdx].toolCalls || []).some(record =>
              record.toolName === 'generate_image' || record.toolName === 'generate_video'
            );
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: suppressInlineError ? currentContent : (currentContent
                ? `${currentContent}\n\n*[System Error: ${error.message || 'Connection timed out'}]*`
                : `*[System Error: ${error.message || 'Connection timed out'}]*`),
              isThinking: false
            };
          }
          return updated;
        });
      },
      onFinish: ({ collectedSignatures: finalSignatures }) => {
        collectedSignatures = finalSignatures;
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
