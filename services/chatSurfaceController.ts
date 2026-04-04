import type { ToolCallRecord } from '../types';

export const createChatSurfaceController = ({
  stopStreaming,
  executeSendFlow,
  dismissActionCard,
  applyActionCard
}: {
  stopStreaming: () => void;
  executeSendFlow: (customText?: string) => Promise<void>;
  dismissActionCard: (toolCall: ToolCallRecord) => Promise<void>;
  applyActionCard: (toolCall: ToolCallRecord) => Promise<void>;
}) => ({
  handleStop: () => stopStreaming(),
  handleSend: (customText?: string) => executeSendFlow(customText),
  handleDismissActionCard: (toolCall: ToolCallRecord) => dismissActionCard(toolCall),
  handleApplyActionCard: (toolCall: ToolCallRecord) => applyActionCard(toolCall)
});
