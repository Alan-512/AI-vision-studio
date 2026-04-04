import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AgentAction, ChatMessage, GenerationParams } from '../types';
import { createChatAgentRuntimeStore } from './chatAgentRuntime';
import type { ActiveChatToolCallStatus } from './chatToolCallRuntime';

export const useChatAgentRuntimeController = ({
  projectId,
  params,
  historyRef,
  onToolCall,
  setToolCallStatus,
  setToolCallExpanded
}: {
  projectId: string;
  params: GenerationParams;
  historyRef: { current: ChatMessage[] };
  onToolCall?: (action: AgentAction) => Promise<any> | any;
  setToolCallStatus: (status: ActiveChatToolCallStatus | null) => void;
  setToolCallExpanded: (expanded: boolean) => void;
}) => {
  const paramsRef = useRef(params);
  const onToolCallRef = useRef(onToolCall);
  const setToolCallStatusRef = useRef(setToolCallStatus);
  const setToolCallExpandedRef = useRef(setToolCallExpanded);
  const previousProjectIdRef = useRef(projectId);

  paramsRef.current = params;
  onToolCallRef.current = onToolCall;
  setToolCallStatusRef.current = setToolCallStatus;
  setToolCallExpandedRef.current = setToolCallExpanded;

  const agentRuntime = useMemo(() => createChatAgentRuntimeStore({
    getParams: () => paramsRef.current,
    getHistory: () => historyRef.current,
    onToolCallRef,
    setToolCallStatus: status => setToolCallStatusRef.current(status),
    setToolCallExpanded: expanded => setToolCallExpandedRef.current(expanded)
  }), [historyRef]);

  const agentState = useSyncExternalStore(
    agentRuntime.subscribe,
    agentRuntime.getState,
    agentRuntime.getState
  );

  useEffect(() => {
    if (previousProjectIdRef.current === projectId) {
      return;
    }
    previousProjectIdRef.current = projectId;
    agentRuntime.reset();
  }, [projectId, agentRuntime]);

  return {
    agentState,
    handleToolCallWithRetry: async (action: AgentAction) => {
      try {
        await agentRuntime.executeGenerateAction(action);
        console.log('[Agent] Action execution completed');
      } catch (error) {
        console.error('[Agent] Action failed after retries:', error);
      }
    }
  };
};
