import type { SubmitUserTurnCommand } from './agentKernelTypes';

export const executeAppSubmitUserTurn = async (command: SubmitUserTurnCommand): Promise<unknown> => {
  const {
    executeStreamingTurn,
    ...streamingInput
  } = (command.payload || {}) as {
    executeStreamingTurn?: (input: any) => Promise<unknown>;
  } & Record<string, unknown>;

  if (!executeStreamingTurn) {
    throw new Error('No app submit-turn handler configured');
  }

  return executeStreamingTurn(streamingInput);
};
