import type { AgentAction, ChatMessage, GenerationParams, SmartAsset, TextModel } from '../types';
import type { StreamingTurnCompatInput, SubmitUserTurnCommand } from './agentKernelTypes';
import { createChatStreamingSurfaceCallbacks } from './chatStreamingSurfaceRuntime';

export const buildSubmitUserTurnCommand = ({
  createId = () => crypto.randomUUID(),
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
  signal,
  onThoughtImage,
  streamingCallbacks,
  onCollectedSignatures
}: {
  createId?: () => string;
  sendingProjectId: string;
  projectIdRef: { current: string };
  nextHistory: ChatMessage[];
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
  signal: AbortSignal;
  onThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void;
  streamingCallbacks: ReturnType<typeof createChatStreamingSurfaceCallbacks>;
  onCollectedSignatures: (signatures: Array<{ partIndex: number; signature: string }>) => void;
}): SubmitUserTurnCommand => {
  const input: StreamingTurnCompatInput = {
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
    params: params as unknown as Record<string, unknown>,
    agentContextAssets,
    signal,
    appendModelPlaceholder: streamingCallbacks.appendModelPlaceholder,
    onChunk: streamingCallbacks.onChunk,
    onThoughtImage,
    onThinkingText: streamingCallbacks.onThinkingText,
    onSearchProgress: progress => streamingCallbacks.onSearchProgress(progress as any),
    onStreamError: streamingCallbacks.onStreamError,
    onFinish: ({ collectedSignatures }) => {
      streamingCallbacks.onFinish({ collectedSignatures });
      onCollectedSignatures(collectedSignatures);
    }
  };

  return {
    type: 'SubmitUserTurn',
    turn: {
      id: createId(),
      sessionId: sendingProjectId,
      userMessage: userMessage.content,
      status: 'ready',
      createdAt: userMessage.timestamp || Date.now(),
      updatedAt: userMessage.timestamp || Date.now(),
      plannedToolCalls: [],
      toolResults: []
    },
    payload: {
      kind: 'streaming_turn',
      input
    }
  };
};
