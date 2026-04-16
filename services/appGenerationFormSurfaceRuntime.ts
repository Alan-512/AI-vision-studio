import type { Dispatch, SetStateAction } from 'react';
import { AppMode, type SmartAsset, type ToolCallRecord } from '../types';

export const createAppGenerationFormSurfaceProps = ({
  contextSummary,
  summaryCursor,
  setContextSummary,
  setSummaryCursor,
  onToolCall,
  dispatchKernelCommand,
  onKeepCurrentAction,
  mode,
  agentContextAssets,
  setAgentContextAssets
}: {
  contextSummary?: string;
  summaryCursor?: number;
  setContextSummary: (value: string) => void;
  setSummaryCursor: (value: number) => void;
  onToolCall: (action: any) => Promise<any>;
  dispatchKernelCommand: (command: any) => Promise<any>;
  onKeepCurrentAction: (toolCall: ToolCallRecord) => Promise<void>;
  mode: AppMode;
  agentContextAssets: SmartAsset[];
  setAgentContextAssets: Dispatch<SetStateAction<SmartAsset[]>>;
}) => ({
  projectContextSummary: contextSummary,
  projectSummaryCursor: summaryCursor,
  onUpdateProjectContext: (summary: string, cursor: number) => {
    setContextSummary(summary);
    setSummaryCursor(cursor);
  },
  onToolCall,
  dispatchKernelCommand,
  onKeepCurrentAction,
  agentContextAssets: mode === AppMode.IMAGE ? agentContextAssets : [],
  onRemoveContextAsset: (assetId: string) =>
    setAgentContextAssets(prev => prev.filter(asset => asset.id !== assetId)),
  onClearContextAssets: () => setAgentContextAssets(() => [])
});
