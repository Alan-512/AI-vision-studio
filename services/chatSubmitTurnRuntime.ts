import type { AgentAction, ChatMessage, GenerationParams, SmartAsset, TextModel } from '../types';
import type { StreamingTurnCompatInput, SubmitUserTurnCommand } from './agentKernelTypes';

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
  surfaceBindingKey
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
  surfaceBindingKey?: string;
}): SubmitUserTurnCommand => {
  const turnId = createId();
  const input: StreamingTurnCompatInput = {
    surfaceBindingKey: surfaceBindingKey ?? turnId,
    sendingProjectId,
    newHistory: nextHistory,
    userMessage,
    selectedModel,
    mode,
    projectContextSummary,
    projectSummaryCursor,
    useSearch,
    params: params as unknown as Record<string, unknown>,
    agentContextAssets
  };

  return {
    type: 'SubmitUserTurn',
    turn: {
      id: turnId,
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
