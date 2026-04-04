import type { StreamingTurnCompatPayload } from './agentKernelTypes';
import { executeChatStreamingTurn } from './chatStreamingRuntime';

export const executeAppSubmitUserTurn = async ({
  payload,
  executeStreamingTurn
}: {
  payload: StreamingTurnCompatPayload;
  executeStreamingTurn: typeof executeChatStreamingTurn;
}): Promise<unknown> => {
  if (payload.kind !== 'streaming_turn') {
    throw new Error(`Unsupported submit-turn payload kind: ${String((payload as { kind?: unknown }).kind ?? 'unknown')}`);
  }

  return executeStreamingTurn(payload.input);
};
