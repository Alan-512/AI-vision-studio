import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage, SearchProgress } from '../types';

export const createChatStreamingSurfaceCallbacks = ({
  sendingProjectId,
  projectIdRef,
  setHistory,
  setThinkingText,
  thinkingTextRef,
  setSearchProgress,
  searchProgressRef,
  setSearchIsCollapsed,
  onCollectedSignatures
}: {
  sendingProjectId: string;
  projectIdRef: { current: string };
  setHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  setThinkingText: Dispatch<SetStateAction<string>>;
  thinkingTextRef: { current: string };
  setSearchProgress: Dispatch<SetStateAction<SearchProgress | null>>;
  searchProgressRef: { current: SearchProgress | null };
  setSearchIsCollapsed: (value: boolean) => void;
  onCollectedSignatures: (signatures: Array<{ partIndex: number; signature: string }>) => void;
}) => ({
  appendModelPlaceholder: () => {
    const tempAiMsg: ChatMessage = { role: 'model', content: '', timestamp: Date.now(), isThinking: true };
    setHistory(prev => [...prev, tempAiMsg]);
  },
  onChunk: (chunkText: string) => {
    setHistory(prev => {
      const updated = [...prev];
      updated[updated.length - 1] = { ...updated[updated.length - 1], content: chunkText };
      return updated;
    });
  },
  onThinkingText: (text: string) => {
    thinkingTextRef.current += text;
    setThinkingText(prev => prev + text);
  },
  onSearchProgress: (progress: SearchProgress) => {
    setSearchProgress(progress);
    searchProgressRef.current = progress;
    if (progress.status === 'complete') {
      setTimeout(() => {
        setSearchIsCollapsed(true);
      }, 2000);
    }
  },
  onStreamError: (error: Error) => {
    console.error('Chat Error:', error);
    if (projectIdRef.current !== sendingProjectId) return;
    setHistory(prev => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (lastIdx >= 0 && updated[lastIdx].role === 'model') {
        const currentContent = updated[lastIdx].content;
        const suppressInlineError = (updated[lastIdx].toolCalls || []).some(record =>
          record.toolName === 'generate_image' || record.toolName === 'generate_video'
        );
        updated[lastIdx] = {
          ...updated[lastIdx],
          content: suppressInlineError ? currentContent : (currentContent
            ? `${currentContent}\n\n*[System Error: ${error.message || 'Connection timed out'}]*`
            : `*[System Error: ${error.message || 'Connection timed out'}]*`),
          isThinking: false
        };
      }
      return updated;
    });
  },
  onFinish: ({ collectedSignatures }: { collectedSignatures: Array<{ partIndex: number; signature: string }> }) => {
    onCollectedSignatures(collectedSignatures);
  }
});
