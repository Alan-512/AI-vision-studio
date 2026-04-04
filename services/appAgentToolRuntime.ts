import type { AgentAction, AgentToolResult } from '../types';
import type { ExecuteToolCallsCommand } from './agentKernelTypes';

export const createAppAgentToolExecutor = ({
  executeToolCall
}: {
  executeToolCall: (action: AgentAction) => Promise<AgentToolResult>;
}) => async (command: ExecuteToolCallsCommand): Promise<AgentToolResult[]> => {
  const results: AgentToolResult[] = [];

  for (const toolCall of command.toolCalls) {
    results.push(await executeToolCall(toolCall));
  }

  return results;
};
