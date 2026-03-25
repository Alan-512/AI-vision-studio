import type { ChatMessage } from '../types';

export interface ActiveChatToolCallStatus {
  isActive: boolean;
  toolName: string;
  model?: string;
  prompt?: string;
  sourceMessageTimestamp?: number;
}

export const resolveActiveToolCallMessageTimestamp = (history: ChatMessage[]): number | undefined => {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.role === 'model' && !message.isSystem) {
      return message.timestamp;
    }
  }

  return undefined;
};

export const shouldShowActiveToolCallForMessage = (
  toolCallStatus: ActiveChatToolCallStatus | null | undefined,
  message: ChatMessage,
  hasPreviewFeedback: boolean
): boolean => (
  !!toolCallStatus?.isActive
  && !hasPreviewFeedback
  && message.role === 'model'
  && !message.isSystem
  && toolCallStatus.sourceMessageTimestamp === message.timestamp
);
