import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage, ToolCallRecord } from '../types';
import { removeChatMessageByTimestamp, resolveChatHistoryKeepCurrent } from './requiresActionRuntime';

export const stopChatStreaming = ({
  abortControllerRef,
  setIsLoading,
  setHistory
}: {
  abortControllerRef: { current: AbortController | null };
  setIsLoading: (value: boolean) => void;
  setHistory: Dispatch<SetStateAction<ChatMessage[]>>;
}) => {
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
  }

  setIsLoading(false);
  setHistory(prev => {
    const updated = [...prev];
    const last = updated[updated.length - 1];
    if (last?.role === 'model' && last.isThinking) {
      updated[updated.length - 1] = { ...last, isThinking: false };
    }
    return updated;
  });
};

export const finalizeChatStreamingTurn = ({
  sendingProjectId,
  projectIdRef,
  abortControllerRef,
  setIsLoading,
  setHistory,
  thinkingTextRef,
  searchProgressRef,
  collectedSignatures
}: {
  sendingProjectId: string;
  projectIdRef: { current: string };
  abortControllerRef: { current: AbortController | null };
  setIsLoading: (value: boolean) => void;
  setHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  thinkingTextRef: { current: string };
  searchProgressRef: { current: any };
  collectedSignatures: Array<{ partIndex: number; signature: string }>;
}) => {
  if (projectIdRef.current !== sendingProjectId) {
    return;
  }

  setIsLoading(false);
  abortControllerRef.current = null;
  const finalThinkingContent = thinkingTextRef.current;
  const finalSearchProgress = searchProgressRef.current;
  setHistory(prev => {
    const updated = [...prev];
    const last = updated[updated.length - 1];
    if (last?.role === 'model') {
      updated[updated.length - 1] = {
        ...last,
        isThinking: false,
        thinkingContent: finalThinkingContent || undefined,
        thoughtSignatures: collectedSignatures.length > 0 ? collectedSignatures : undefined,
        searchProgress: finalSearchProgress || undefined
      };
    }
    return updated;
  });
};

export const resolveSuggestedPrompt = (toolCall: ToolCallRecord): string => {
  const payload = toolCall.result?.requiresAction?.payload as Record<string, unknown> | undefined;
  if (typeof payload?.revisedPrompt === 'string' && payload.revisedPrompt.trim()) return payload.revisedPrompt;
  if (typeof toolCall.result?.metadata?.revisedPrompt === 'string' && String(toolCall.result.metadata.revisedPrompt).trim()) {
    return String(toolCall.result.metadata.revisedPrompt);
  }
  if (typeof payload?.prompt === 'string' && payload.prompt.trim()) return payload.prompt;
  if (typeof toolCall.args?.prompt === 'string' && toolCall.args.prompt.trim()) return toolCall.args.prompt;
  return '';
};

export const dismissChatActionCard = async ({
  toolCall,
  history,
  setHistory,
  setDismissedActionCardIds,
  onKeepCurrentAction,
  now = () => Date.now()
}: {
  toolCall: ToolCallRecord;
  history: ChatMessage[];
  setHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  setDismissedActionCardIds: Dispatch<SetStateAction<Record<string, boolean>>>;
  onKeepCurrentAction?: (toolCall: ToolCallRecord) => Promise<void> | void;
  now?: () => number;
}) => {
  const resolvedAt = now();
  const previousHistory = history;
  setDismissedActionCardIds(prev => ({ ...prev, [toolCall.id]: true }));
  setHistory(resolveChatHistoryKeepCurrent(history, toolCall.id, resolvedAt));

  try {
    await onKeepCurrentAction?.(toolCall);
  } catch (error) {
    console.error('[ChatInterface] Failed to keep current result', error);
    setHistory(previousHistory);
    setDismissedActionCardIds(prev => {
      const next = { ...prev };
      delete next[toolCall.id];
      return next;
    });
  }
};

export const applyChatActionCard = async ({
  toolCall,
  language,
  setHistory,
  setDismissedActionCardIds,
  setApplyingActionCardId,
  handleToolCallWithRetry,
  now = () => Date.now()
}: {
  toolCall: ToolCallRecord;
  language: string;
  setHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  setDismissedActionCardIds: Dispatch<SetStateAction<Record<string, boolean>>>;
  setApplyingActionCardId: Dispatch<SetStateAction<string | null>>;
  handleToolCallWithRetry: (input: { toolName: string; args: any }) => Promise<void>;
  now?: () => number;
}) => {
  if (toolCall.toolName !== 'generate_image') return;
  const suggestedPrompt = resolveSuggestedPrompt(toolCall);
  if (!suggestedPrompt) return;

  const payload = toolCall.result?.requiresAction?.payload as Record<string, unknown> | undefined;
  const reviewPlan = payload?.reviewPlan as { summary?: string; localized?: { zh?: { summary?: string }; en?: { summary?: string } } } | undefined;
  const localizedPlanSummary = language === 'zh'
    ? reviewPlan?.localized?.zh?.summary
    : reviewPlan?.localized?.en?.summary;
  const optimisticMessageTimestamp = now();

  setApplyingActionCardId(toolCall.id);
  setDismissedActionCardIds(prev => ({ ...prev, [toolCall.id]: true }));
  setHistory(prev => [
    ...prev,
    {
      role: 'user',
      isSystem: true,
      content: language === 'zh'
        ? `继续按当前优化方向处理这一版。${localizedPlanSummary ? `\n${localizedPlanSummary}` : ''}`
        : `Continuing with the current refinement plan.${localizedPlanSummary ? `\n${localizedPlanSummary}` : ''}`,
      timestamp: optimisticMessageTimestamp
    }
  ]);

  try {
    await handleToolCallWithRetry({
      toolName: toolCall.toolName,
      args: {
        ...(toolCall.args || {}),
        prompt: suggestedPrompt,
        resume_job_id: toolCall.result?.jobId,
        requires_action_type: toolCall.result?.requiresAction?.type
      }
    });
  } catch (error) {
    console.error('[ChatInterface] Failed to apply action card', error);
    setHistory(prev => removeChatMessageByTimestamp(prev, optimisticMessageTimestamp));
    setDismissedActionCardIds(prev => {
      const next = { ...prev };
      delete next[toolCall.id];
      return next;
    });
  } finally {
    setApplyingActionCardId(current => current === toolCall.id ? null : current);
  }
};
