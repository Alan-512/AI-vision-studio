import { describe, expect, it, vi } from 'vitest';
import { AppMode, type AgentAction, type AgentToolResult } from '../types';
import { createAppAgentToolCallHandler } from '../services/appAgentToolCallRuntime';

describe('appAgentToolCallRuntime', () => {
  it('returns a deduplicated success result when the same tool call is already processing', async () => {
    const processing = new Set<string>(['generate_image-{"prompt":"poster"}']);
    const handler = createAppAgentToolCallHandler({
      mode: AppMode.IMAGE,
      processingToolCallKeys: processing,
      createToolCallId: () => 'tool-1',
      createToolCallKey: () => 'generate_image-{"prompt":"poster"}',
      upsertLastModelToolCall: vi.fn(),
      updateLastModelMessage: vi.fn(),
      setChatHistory: vi.fn(),
      handleModeSwitch: vi.fn(),
      addToast: vi.fn(),
      handleGenerate: vi.fn(),
      normalizeAssistantMode: vi.fn(),
      getPlaybookDefaults: vi.fn(),
      loadAgentJobsByProject: vi.fn(),
      activeProjectId: 'project-1',
      chatParams: {} as any,
      chatHistory: [],
      chatEditParams: {},
      setRightPanelMode: vi.fn(),
      setThoughtImages: vi.fn(),
      setChatEditParams: vi.fn(),
      setAgentContextAssets: vi.fn(),
      playSuccessSound: vi.fn(),
      extractSearchContextFromProgress: vi.fn(),
      selectReferenceRecords: vi.fn(),
      latestSearchProgress: undefined,
      compressImageForContext: vi.fn()
    });

    const result = await handler({
      toolName: 'generate_image',
      args: { prompt: 'poster' }
    } as AgentAction);

    expect(result).toEqual({
      jobId: '',
      toolName: 'generate_image',
      status: 'success',
      message: 'Duplicate tool call ignored.',
      metadata: { deduplicated: true }
    } satisfies AgentToolResult);
  });

  it('returns a tool error when generate_image prompt is missing', async () => {
    const upsertLastModelToolCall = vi.fn();
    const handler = createAppAgentToolCallHandler({
      mode: AppMode.IMAGE,
      processingToolCallKeys: new Set<string>(),
      createToolCallId: () => 'tool-1',
      createToolCallKey: () => 'generate_image-{}',
      upsertLastModelToolCall,
      updateLastModelMessage: vi.fn(),
      setChatHistory: vi.fn(),
      handleModeSwitch: vi.fn(),
      addToast: vi.fn(),
      handleGenerate: vi.fn(),
      normalizeAssistantMode: vi.fn(),
      getPlaybookDefaults: vi.fn(),
      loadAgentJobsByProject: vi.fn(),
      activeProjectId: 'project-1',
      chatParams: {} as any,
      chatHistory: [],
      chatEditParams: {},
      setRightPanelMode: vi.fn(),
      setThoughtImages: vi.fn(),
      setChatEditParams: vi.fn(),
      setAgentContextAssets: vi.fn(),
      playSuccessSound: vi.fn(),
      extractSearchContextFromProgress: vi.fn(),
      selectReferenceRecords: vi.fn(),
      latestSearchProgress: undefined,
      compressImageForContext: vi.fn()
    });

    const result = await handler({
      toolName: 'generate_image',
      args: {}
    } as AgentAction);

    expect(result.status).toBe('error');
    expect(result.error).toContain('Prompt missing');
    expect(upsertLastModelToolCall).toHaveBeenCalled();
  });

  it('returns an unsupported-tool error for unknown tools', async () => {
    const handler = createAppAgentToolCallHandler({
      mode: AppMode.IMAGE,
      processingToolCallKeys: new Set<string>(),
      createToolCallId: () => 'tool-1',
      createToolCallKey: () => 'unknown-{}',
      upsertLastModelToolCall: vi.fn(),
      updateLastModelMessage: vi.fn(),
      setChatHistory: vi.fn(),
      handleModeSwitch: vi.fn(),
      addToast: vi.fn(),
      handleGenerate: vi.fn(),
      normalizeAssistantMode: vi.fn(),
      getPlaybookDefaults: vi.fn(),
      loadAgentJobsByProject: vi.fn(),
      activeProjectId: 'project-1',
      chatParams: {} as any,
      chatHistory: [],
      chatEditParams: {},
      setRightPanelMode: vi.fn(),
      setThoughtImages: vi.fn(),
      setChatEditParams: vi.fn(),
      setAgentContextAssets: vi.fn(),
      playSuccessSound: vi.fn(),
      extractSearchContextFromProgress: vi.fn(),
      selectReferenceRecords: vi.fn(),
      latestSearchProgress: undefined,
      compressImageForContext: vi.fn()
    });

    const result = await handler({
      toolName: 'unknown_tool',
      args: {}
    } as AgentAction);

    expect(result).toEqual({
      jobId: '',
      toolName: 'unknown_tool',
      status: 'error',
      error: 'Unsupported tool: unknown_tool'
    });
  });
});
