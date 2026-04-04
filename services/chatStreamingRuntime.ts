import type { AgentAction, ChatMessage, GenerationParams, SearchProgress, SmartAsset, TextModel } from '../types';
import { streamChatResponse } from './geminiService';

export const buildOutgoingChatMessage = ({
  content,
  history,
  selectedImages,
  agentContextAssets,
  timestamp
}: {
  content: string;
  history: ChatMessage[];
  selectedImages: string[];
  agentContextAssets?: SmartAsset[];
  timestamp?: number;
}) => {
  const contextImageUrls = (agentContextAssets || []).map(asset => `data:${asset.mimeType};base64,${asset.data}`);
  const allImages = [...contextImageUrls, ...selectedImages];
  const userMessage: ChatMessage = {
    role: 'user',
    content,
    timestamp: timestamp ?? Date.now(),
    images: allImages.length > 0 ? allImages : undefined
  };

  return {
    userMessage,
    nextHistory: [...history, userMessage]
  };
};

export const executeChatStreamingTurn = async ({
  sendingProjectId,
  projectIdRef,
  newHistory,
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
  appendModelPlaceholder,
  onChunk,
  onThoughtImage,
  onThinkingText,
  onSearchProgress,
  onStreamError,
  onFinish,
  signal,
  streamChatResponseImpl = streamChatResponse
}: {
  sendingProjectId: string;
  projectIdRef: { current: string };
  newHistory: ChatMessage[];
  userMessage: ChatMessage;
  selectedModel: TextModel;
  mode: any;
  projectContextSummary?: string;
  projectSummaryCursor?: number;
  onUpdateProjectContext?: (summary: string, cursor: number) => void;
  handleToolCallWithRetry: (action: AgentAction) => Promise<void>;
  useSearch: boolean;
  params: GenerationParams;
  agentContextAssets?: SmartAsset[];
  appendModelPlaceholder: () => void;
  onChunk: (chunkText: string) => void;
  onThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void;
  onThinkingText: (text: string) => void;
  onSearchProgress: (progress: SearchProgress) => void;
  onStreamError: (error: Error) => void;
  onFinish: (result: {
    collectedSignatures: Array<{ partIndex: number; signature: string }>;
  }) => void;
  signal: AbortSignal;
  streamChatResponseImpl?: typeof streamChatResponse;
}) => {
  let collectedSignatures: Array<{ partIndex: number; signature: string }> = [];

  appendModelPlaceholder();

  try {
    await streamChatResponseImpl(
      newHistory,
      userMessage.content,
      chunkText => {
        if (projectIdRef.current !== sendingProjectId) return;
        onChunk(chunkText);
      },
      selectedModel,
      mode,
      signal,
      projectContextSummary,
      projectSummaryCursor,
      onUpdateProjectContext,
      handleToolCallWithRetry,
      useSearch,
      params,
      agentContextAssets,
      signatures => {
        collectedSignatures = signatures;
      },
      onThoughtImage
        ? imageData => {
            if (projectIdRef.current !== sendingProjectId) return;
            onThoughtImage(imageData);
          }
        : undefined,
      text => {
        if (projectIdRef.current !== sendingProjectId) return;
        onThinkingText(text);
      },
      progress => {
        if (projectIdRef.current !== sendingProjectId) return;
        onSearchProgress(progress);
      }
    );
  } catch (error: any) {
    if (error.message !== 'Cancelled' && error.name !== 'AbortError') {
      onStreamError(error);
    }
  } finally {
    if (projectIdRef.current === sendingProjectId) {
      onFinish({ collectedSignatures });
    }
  }
};
