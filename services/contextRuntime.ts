import { ChatMessage } from '../types';

export const DEFAULT_RECENT_MESSAGE_WINDOW = 8;

export type SummaryRange = {
  from: number;
  to: number;
};

export type CompactedConversationContext = {
  effectiveSummary: string;
  recentHistory: ChatMessage[];
  nextSummaryRange?: SummaryRange;
};

const clampCursor = (cursor: number | undefined, historyLength: number): number => {
  if (typeof cursor !== 'number' || Number.isNaN(cursor)) return 0;
  return Math.min(Math.max(Math.floor(cursor), 0), historyLength);
};

export const compactConversationContext = (
  history: ChatMessage[],
  contextSummary?: string,
  summaryCursor?: number,
  recentWindow: number = DEFAULT_RECENT_MESSAGE_WINDOW
): CompactedConversationContext => {
  const normalizedCursor = clampCursor(summaryCursor, history.length);
  const trimmedSummary = (contextSummary || '').trim();
  const unsummarized = history.slice(normalizedCursor);

  if (unsummarized.length <= recentWindow) {
    return {
      effectiveSummary: trimmedSummary,
      recentHistory: unsummarized
    };
  }

  const cutoff = Math.max(normalizedCursor, history.length - recentWindow);
  return {
    effectiveSummary: trimmedSummary,
    recentHistory: history.slice(cutoff),
    nextSummaryRange: cutoff > normalizedCursor ? { from: normalizedCursor, to: cutoff } : undefined
  };
};

const summarizeImages = (message: ChatMessage): string => {
  const imageCount = (message.images?.length || 0) + (message.image ? 1 : 0);
  if (imageCount === 0) return '';
  return ` [images:${imageCount}]`;
};

const sanitizeMessageContent = (content: string): string =>
  content
    .replace(/\[SYSTEM_FEEDBACK\]:.*?(\n|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const serializeMessagesForSummary = (history: ChatMessage[]): string =>
  history
    .map((message, index) => {
      const role = message.role === 'model' ? 'Assistant' : message.role === 'user' ? 'User' : 'System';
      const content = sanitizeMessageContent(message.content || '');
      return `${index + 1}. ${role}:${summarizeImages(message)} ${content}`.trim();
    })
    .filter(Boolean)
    .join('\n');

