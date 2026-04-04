import { describe, expect, it } from 'vitest';
import { deriveChatAgentSurfaceStatus } from '../services/chatAgentSurfaceRuntime';
import { createInitialAgentState } from '../services/agentService';

describe('chatAgentSurfaceRuntime', () => {
  it('maps retrying agent state to retry surface status', () => {
    const status = deriveChatAgentSurfaceStatus({
      ...createInitialAgentState(),
      phase: 'RETRYING',
      retryCount: 2,
      maxRetries: 3
    });

    expect(status).toEqual({
      kind: 'retrying',
      retryCount: 2,
      maxRetries: 3
    });
  });

  it('maps error agent state to error surface status', () => {
    const status = deriveChatAgentSurfaceStatus({
      ...createInitialAgentState(),
      phase: 'ERROR',
      error: 'Generation failed'
    });

    expect(status).toEqual({
      kind: 'error',
      message: 'Generation failed'
    });
  });

  it('maps non-error execution states to idle surface status', () => {
    const status = deriveChatAgentSurfaceStatus({
      ...createInitialAgentState(),
      phase: 'EXECUTING'
    });

    expect(status).toEqual({ kind: 'idle' });
  });
});
