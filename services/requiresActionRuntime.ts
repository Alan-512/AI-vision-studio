import { AgentJob, AgentToolCallStatus, AgentToolResultStatus, ChatMessage, ToolCallRecord } from '../types';

export const resolveToolCallRecordStatus = (resultStatus: AgentToolResultStatus): AgentToolCallStatus => {
  if (resultStatus === 'success') return 'success';
  if (resultStatus === 'requires_action') return 'requires_action';
  return 'failed';
};

export const resolveToolCallAfterKeepCurrent = (record: ToolCallRecord, now: number): ToolCallRecord => ({
  ...record,
  status: 'success',
  completedAt: record.completedAt ?? now,
  result: record.result
    ? {
      ...record.result,
      status: 'success',
      error: undefined,
      requiresAction: undefined,
      metadata: {
        ...(record.result.metadata || {}),
        resolution: {
          type: 'keep_current',
          resolvedAt: now
        }
      }
    }
    : record.result
});

export const resolveChatHistoryKeepCurrent = (
  history: ChatMessage[],
  toolCallId: string,
  now: number
): ChatMessage[] => history.map(message => {
  if (!Array.isArray(message.toolCalls) || !message.toolCalls.some(record => record.id === toolCallId)) {
    return message;
  }

  return {
    ...message,
    toolCalls: message.toolCalls.map(record => (
      record.id === toolCallId ? resolveToolCallAfterKeepCurrent(record, now) : record
    ))
  };
});

export const resolveAgentJobKeepCurrent = (
  job: AgentJob,
  options: {
    now: number;
    stepId: string;
    actionType?: string;
    prompt?: string;
  }
): AgentJob => ({
  ...job,
  status: 'completed',
  currentStepId: undefined,
  lastError: undefined,
  requiresAction: undefined,
  updatedAt: options.now,
  steps: [
    ...job.steps,
    {
      id: options.stepId,
      kind: 'system',
      name: 'keep_current_requires_action',
      status: 'success',
      input: {
        actionType: options.actionType || 'keep_current',
        prompt: options.prompt
      },
      output: {
        resolution: 'keep_current',
        resolvedAt: options.now
      }
    }
  ]
});

export const removeChatMessageByTimestamp = (history: ChatMessage[], timestamp: number): ChatMessage[] =>
  history.filter(message => message.timestamp !== timestamp);
