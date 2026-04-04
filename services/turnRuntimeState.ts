import type { AgentAction } from '../types';
import type { KernelErrorType, TurnRuntimeState } from './agentKernelTypes';

type CreateTurnRuntimeStateOptions = {
  turnId: string;
  sessionId: string;
  userMessage: string;
  now?: number;
};

type PlanTurnToolCallsOptions = {
  toolCalls: AgentAction[];
  now?: number;
};

type CompleteTurnRuntimeStateOptions = {
  assistantText: string;
  now?: number;
};

type FailTurnRuntimeStateOptions = {
  error: string;
  errorType: KernelErrorType;
  now?: number;
};

type AttachTurnActiveJobOptions = {
  jobId: string;
  now?: number;
};

const resolveNow = (now?: number) => now ?? Date.now();

export const createTurnRuntimeState = ({
  turnId,
  sessionId,
  userMessage,
  now
}: CreateTurnRuntimeStateOptions): TurnRuntimeState => {
  const timestamp = resolveNow(now);
  return {
    id: turnId,
    sessionId,
    userMessage,
    status: 'ready',
    createdAt: timestamp,
    updatedAt: timestamp,
    plannedToolCalls: [],
    toolResults: []
  };
};

export const planTurnToolCalls = (
  turn: TurnRuntimeState,
  {
    toolCalls,
    now
  }: PlanTurnToolCallsOptions
): TurnRuntimeState => ({
  ...turn,
  status: 'planning',
  updatedAt: resolveNow(now),
  plannedToolCalls: [...toolCalls]
});

export const attachTurnActiveJob = (
  turn: TurnRuntimeState,
  {
    jobId,
    now
  }: AttachTurnActiveJobOptions
): TurnRuntimeState => ({
  ...turn,
  status: 'waiting_on_job',
  updatedAt: resolveNow(now),
  activeJobId: jobId
});

export const completeTurnRuntimeState = (
  turn: TurnRuntimeState,
  {
    assistantText,
    now
  }: CompleteTurnRuntimeStateOptions
): TurnRuntimeState => ({
  ...turn,
  status: 'completed',
  updatedAt: resolveNow(now),
  outputText: assistantText
});

export const failTurnRuntimeState = (
  turn: TurnRuntimeState,
  {
    error,
    errorType,
    now
  }: FailTurnRuntimeStateOptions
): TurnRuntimeState => ({
  ...turn,
  status: 'failed',
  updatedAt: resolveNow(now),
  error: {
    type: errorType,
    message: error
  }
});
