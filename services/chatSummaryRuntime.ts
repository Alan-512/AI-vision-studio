import type { ChatMessage } from '../types';

export const updateChatRollingSummary = async ({
  onUpdateContext,
  nextSummaryRange,
  effectiveSummary,
  history,
  fullText,
  summarizeConversation
}: {
  onUpdateContext?: (summary: string, cursor: number) => void;
  nextSummaryRange?: { from: number; to: number };
  effectiveSummary: string;
  history: ChatMessage[];
  fullText: string;
  summarizeConversation: (existingSummary: string, historySlice: ChatMessage[]) => Promise<string>;
}) => {
  if (!onUpdateContext || !nextSummaryRange) {
    return;
  }

  const historyForSummary = fullText.trim()
    ? [
        ...history,
        { role: 'model', content: fullText, timestamp: Date.now() } as ChatMessage
      ]
    : history;

  const summarySourceSlice = historyForSummary.slice(
    nextSummaryRange.from,
    Math.min(nextSummaryRange.to, historyForSummary.length)
  );

  if (summarySourceSlice.length === 0) {
    return;
  }

  const nextSummary = await summarizeConversation(effectiveSummary, summarySourceSlice);
  onUpdateContext(nextSummary, nextSummaryRange.to);
};
