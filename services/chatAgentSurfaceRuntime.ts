import type { AgentState } from './agentService';

export type ChatAgentSurfaceStatus =
  | { kind: 'idle' }
  | { kind: 'retrying'; retryCount: number; maxRetries: number }
  | { kind: 'error'; message: string };

export const deriveChatAgentSurfaceStatus = (state: AgentState): ChatAgentSurfaceStatus => {
  if (state.phase === 'RETRYING') {
    return {
      kind: 'retrying',
      retryCount: state.retryCount,
      maxRetries: state.maxRetries
    };
  }

  if (state.phase === 'ERROR') {
    return {
      kind: 'error',
      message: state.error || 'Action failed'
    };
  }

  return { kind: 'idle' };
};
