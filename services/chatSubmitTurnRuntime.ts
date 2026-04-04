import type { ChatMessage, GenerationParams, SmartAsset, TextModel } from '../types';
import type { StreamingTurnCompatInput, SubmitUserTurnCommand } from './agentKernelTypes';

export const buildSubmitUserTurnCommand = ({
  createId = () => crypto.randomUUID(),
  sendingProjectId,
  nextHistory,
  userMessage,
  selectedModel,
  mode,
  projectContextSummary,
  projectSummaryCursor,
  useSearch,
  params,
  agentContextAssets,
  surfaceBindingKey
}: {
  createId?: () => string;
  sendingProjectId: string;
  nextHistory: ChatMessage[];
  userMessage: ChatMessage;
  selectedModel: TextModel;
  mode: any;
  projectContextSummary?: string;
  projectSummaryCursor?: number;
  useSearch: boolean;
  params: GenerationParams;
  agentContextAssets?: SmartAsset[];
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
