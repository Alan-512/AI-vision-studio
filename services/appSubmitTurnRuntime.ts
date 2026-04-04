import type { StreamingTurnCompatPayload } from './agentKernelTypes';
import { executeChatStreamingTurn } from './chatStreamingRuntime';
import {
  getStreamingTurnSurfaceBindings,
  type StreamingTurnBindings
} from './streamingTurnSurfaceBindingRuntime';

export const executeAppSubmitUserTurn = async ({
  payload,
  executeStreamingTurn,
  resolveSurfaceBindings = getStreamingTurnSurfaceBindings
}: {
  payload: StreamingTurnCompatPayload;
  executeStreamingTurn: typeof executeChatStreamingTurn;
  resolveSurfaceBindings?: (key: string) => StreamingTurnBindings | undefined;
}): Promise<unknown> => {
  if (payload.kind !== 'streaming_turn') {
    throw new Error(`Unsupported submit-turn payload kind: ${String((payload as { kind?: unknown }).kind ?? 'unknown')}`);
  }

  const surfaceBindings = resolveSurfaceBindings(payload.input.surfaceBindingKey);
  if (!surfaceBindings) {
    throw new Error(`Missing streaming surface bindings for key: ${payload.input.surfaceBindingKey}`);
  }

  return executeStreamingTurn({
    ...payload.input,
    ...surfaceBindings
  });
};
