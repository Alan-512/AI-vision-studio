import type { AgentAction, JobTransitionResult } from '../types';

// Kernel contracts define the split write model:
// - TurnRuntimeState: ephemeral truth for the active turn
// - AgentJob: durable truth for recoverable work
// Projection-only intents such as dismissing task cards stay out of KernelCommand.

export type ToolClass = 'interactive_tool' | 'job_tool' | 'kernel_step';

export type KernelErrorType =
  | 'model_error'
  | 'tool_error'
  | 'permission_denied'
  | 'protocol_error'
  | 'user_interrupt';

export type TurnRuntimeStateStatus =
  | 'ready'
  | 'planning'
  | 'waiting_on_tools'
  | 'waiting_on_job'
  | 'completed'
  | 'failed';

export interface TurnRuntimeError {
  type: KernelErrorType;
  message: string;
}

export interface TurnRuntimeState {
  id: string;
  sessionId: string;
  userMessage: string;
  status: TurnRuntimeStateStatus;
  createdAt: number;
  updatedAt: number;
  plannedToolCalls: AgentAction[];
  toolResults: Array<{
    toolName: string;
    status: 'success' | 'error' | 'requires_action';
  }>;
  outputText?: string;
  activeJobId?: string;
  error?: TurnRuntimeError;
}

export type StreamingTurnCompatInput = {
  surfaceBindingKey: string;
  sendingProjectId: string;
  newHistory: unknown[];
  userMessage: unknown;
  selectedModel: unknown;
  mode: unknown;
  projectContextSummary?: string;
  projectSummaryCursor?: number;
  useSearch: boolean;
  params: Record<string, unknown>;
  agentContextAssets?: unknown[];
};

export type StreamingTurnCompatPayload = {
  kind: 'streaming_turn';
  input: StreamingTurnCompatInput;
};

export type StartGenerationCompatInput = {
  bindingKey: string;
  currentProjectId?: string;
  resolvedJobSource?: 'chat' | 'studio' | 'resume';
};

export type StartGenerationCompatPayload = {
  kind: 'generation_request';
  input: StartGenerationCompatInput;
};

export type SubmitUserTurnCommand = {
  type: 'SubmitUserTurn';
  turn: TurnRuntimeState;
  payload?: StreamingTurnCompatPayload;
};

export type ExecuteToolCallsCommand = {
  type: 'ExecuteToolCalls';
  turnId: string;
  sessionId?: string;
  projectId?: string;
  source?: 'chat' | 'studio' | 'resume';
  toolCalls: AgentAction[];
};

export type ResolveRequiresActionCommand = {
  type: 'ResolveRequiresAction';
  jobId: string;
  resolutionType: string;
  payload?: Record<string, unknown>;
};

export type CancelJobCommand = {
  type: 'CancelJob';
  jobId: string;
  reason?: string;
};

export type ResumeJobCommand = {
  type: 'ResumeJob';
  jobId: string;
  actionType?: string;
};

export type StartGenerationCommand = {
  type: 'StartGeneration';
  payload: StartGenerationCompatPayload;
};

export type KernelCommand =
  | SubmitUserTurnCommand
  | ExecuteToolCallsCommand
  | ResolveRequiresActionCommand
  | CancelJobCommand
  | ResumeJobCommand
  | StartGenerationCommand;

export type KernelTransitionEventType =
  | 'TurnStarted'
  | 'ToolCallsPlanned'
  | 'ToolResultsReinjected'
  | 'JobTransitioned'
  | 'TurnCompleted'
  | 'TurnFailed';

export interface KernelTransitionEvent {
  type: KernelTransitionEventType;
  turnId: string;
  timestamp: number;
  jobId?: string;
  payload?: Record<string, unknown>;
}

export interface KernelTransitionResult {
  turn: TurnRuntimeState;
  events: KernelTransitionEvent[];
  jobTransition?: JobTransitionResult;
  toolResults?: unknown[];
  turnOutput?: unknown;
}
