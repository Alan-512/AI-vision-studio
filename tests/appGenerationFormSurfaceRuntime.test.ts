import { describe, expect, it, vi } from 'vitest';
import { AppMode } from '../types';
import { createAppGenerationFormSurfaceProps } from '../services/appGenerationFormSurfaceRuntime';

describe('appGenerationFormSurfaceRuntime', () => {
  it('builds generation form surface props and hides context assets outside image mode', async () => {
    const setContextSummary = vi.fn();
    const setSummaryCursor = vi.fn();
    const setAgentContextAssets = vi.fn();
    const onToolCall = vi.fn();
    const dispatchKernelCommand = vi.fn();
    const onKeepCurrentAction = vi.fn();

    const props = createAppGenerationFormSurfaceProps({
      contextSummary: 'summary',
      summaryCursor: 12,
      setContextSummary,
      setSummaryCursor,
      onToolCall,
      dispatchKernelCommand,
      onKeepCurrentAction,
      mode: AppMode.VIDEO,
      agentContextAssets: [{ id: 'asset-1', data: 'abc', mimeType: 'image/png' }],
      setAgentContextAssets
    });

    expect(props.projectContextSummary).toBe('summary');
    expect(props.projectSummaryCursor).toBe(12);
    expect(props.agentContextAssets).toEqual([]);

    props.onUpdateProjectContext('next', 13);
    expect(setContextSummary).toHaveBeenCalledWith('next');
    expect(setSummaryCursor).toHaveBeenCalledWith(13);

    props.onRemoveContextAsset('asset-1');
    expect(setAgentContextAssets).toHaveBeenCalledTimes(1);

    props.onClearContextAssets();
    expect(setAgentContextAssets).toHaveBeenCalledTimes(2);
  });
});
