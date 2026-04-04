import type { AgentAction, JobTransitionResult } from '../types';

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

export type SubmitUserTurnCommand = {
  type: 'SubmitUserTurn';
  turn: TurnRuntimeState;
  payload?: Record<string, unknown>;
};

export type ExecuteToolCallsCommand = {
  type: 'ExecuteToolCalls';
  turnId: string;
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
  payload: Record<string, unknown>;
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
