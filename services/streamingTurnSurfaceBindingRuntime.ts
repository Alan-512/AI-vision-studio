import type { AgentAction, SearchProgress } from '../types';

export type StreamingTurnBindings = {
  projectIdRef: { current: string };
  onUpdateProjectContext?: (summary: string, cursor: number) => void;
  handleToolCallWithRetry: (action: AgentAction) => Promise<void>;
  signal: AbortSignal;
  appendModelPlaceholder: () => void;
  onChunk: (chunkText: string) => void;
  onThoughtImage?: (imageData: { data: string; mimeType: string; isFinal: boolean }) => void;
  onThinkingText: (text: string) => void;
  onSearchProgress: (progress: SearchProgress) => void;
  onStreamError: (error: Error) => void;
  onFinish: (result: { collectedSignatures: Array<{ partIndex: number; signature: string }> }) => void;
};

const bindingRegistry = new Map<string, StreamingTurnBindings>();

export const registerStreamingTurnSurfaceBindings = (key: string, bindings: StreamingTurnBindings) => {
  bindingRegistry.set(key, bindings);
};

export const getStreamingTurnSurfaceBindings = (key: string) => bindingRegistry.get(key);

export const clearStreamingTurnSurfaceBindings = (key: string) => {
  bindingRegistry.delete(key);
};
