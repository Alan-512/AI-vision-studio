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
      extractSearchContextFromProgress: vi.fn(),
      selectReferenceRecords: vi.fn(),
      latestSearchProgress: undefined,
      compressImageForContext: vi.fn(),
      resolveToolCallRecordStatus: vi.fn().mockReturnValue('success')
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
      extractSearchContextFromProgress: vi.fn(),
      selectReferenceRecords: vi.fn(),
      latestSearchProgress: undefined,
      compressImageForContext: vi.fn(),
      resolveToolCallRecordStatus: vi.fn().mockReturnValue('failed')
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
      extractSearchContextFromProgress: vi.fn(),
      selectReferenceRecords: vi.fn(),
      latestSearchProgress: undefined,
      compressImageForContext: vi.fn(),
      resolveToolCallRecordStatus: vi.fn().mockReturnValue('failed')
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

  it('passes explicit sequence frame prompts through the unified generation contract', async () => {
    const handleGenerate = vi.fn().mockResolvedValue([{
      jobId: 'job-1',
      toolName: 'generate_image',
      status: 'success'
    } satisfies AgentToolResult]);

    const handler = createAppAgentToolCallHandler({
      mode: AppMode.IMAGE,
      processingToolCallKeys: new Set<string>(),
      createToolCallId: () => 'tool-1',
      createToolCallKey: () => 'generate_image-sequence',
      upsertLastModelToolCall: vi.fn(),
      updateLastModelMessage: vi.fn(),
      setChatHistory: vi.fn(),
      handleModeSwitch: vi.fn(),
      addToast: vi.fn(),
      handleGenerate,
      normalizeAssistantMode: vi.fn(),
      getPlaybookDefaults: vi.fn().mockReturnValue({}),
      loadAgentJobsByProject: vi.fn().mockResolvedValue([]),
      activeProjectId: 'project-1',
      chatParams: {} as any,
      chatHistory: [],
      chatEditParams: {},
      setRightPanelMode: vi.fn(),
      setThoughtImages: vi.fn(),
      setChatEditParams: vi.fn(),
      setAgentContextAssets: vi.fn(),
      extractSearchContextFromProgress: vi.fn(),
      selectReferenceRecords: vi.fn().mockReturnValue([]),
      latestSearchProgress: undefined,
      compressImageForContext: vi.fn(),
      resolveToolCallRecordStatus: vi.fn().mockReturnValue('success')
    });

    await handler({
      toolName: 'generate_image',
      args: {
        prompt: 'weather anchor sequence',
        numberOfImages: 2,
        sequence_frame_prompts: [
          'Frame 1: anchor introduces today weather.',
          'Frame 2: anchor points to storm cell.'
        ]
      }
    } as AgentAction);

    expect(handleGenerate).toHaveBeenCalledWith(expect.objectContaining({
      sequenceFramePrompts: [
        'Frame 1: anchor introduces today weather.',
        'Frame 2: anchor points to storm cell.'
      ],
      numberOfImages: 2
    }), expect.any(Object));
  });

  it('rewrites multi-call separate frame intents into single-frame generation prompts', async () => {
    const handleGenerate = vi.fn().mockResolvedValue([{
      jobId: 'job-1',
      toolName: 'generate_image',
      status: 'success'
    } satisfies AgentToolResult]);

    const handler = createAppAgentToolCallHandler({
      mode: AppMode.IMAGE,
      processingToolCallKeys: new Set<string>(),
      createToolCallId: () => 'tool-1',
      createToolCallKey: () => 'generate_image-frame-intent',
      upsertLastModelToolCall: vi.fn(),
      updateLastModelMessage: vi.fn(),
      setChatHistory: vi.fn(),
      handleModeSwitch: vi.fn(),
      addToast: vi.fn(),
      handleGenerate,
      normalizeAssistantMode: vi.fn(),
      getPlaybookDefaults: vi.fn().mockReturnValue({}),
      loadAgentJobsByProject: vi.fn().mockResolvedValue([]),
      activeProjectId: 'project-1',
      chatParams: {} as any,
      chatHistory: [],
      chatEditParams: {},
      setRightPanelMode: vi.fn(),
      setThoughtImages: vi.fn(),
      setChatEditParams: vi.fn(),
      setAgentContextAssets: vi.fn(),
      extractSearchContextFromProgress: vi.fn(),
      selectReferenceRecords: vi.fn().mockReturnValue([]),
      latestSearchProgress: undefined,
      compressImageForContext: vi.fn(),
      resolveToolCallRecordStatus: vi.fn().mockReturnValue('success')
    });

    await handler({
      toolName: 'generate_image',
      args: {
        prompt: 'A wide shot in a TV news studio, continuing the sequence as the anchor moves toward center stage.',
        sequence_intent: 'separate_frames',
        frame_index: 1,
        frame_total: 4
      }
    } as AgentAction);

    expect(handleGenerate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('Render exactly one standalone frame'),
      numberOfImages: 1
    }), expect.any(Object));
  });

  it('normalizes numberOfImages from explicit sequence frame prompts when omitted', async () => {
    const handleGenerate = vi.fn().mockResolvedValue([{
      jobId: 'job-1',
      toolName: 'generate_image',
      status: 'success'
    } satisfies AgentToolResult]);

    const handler = createAppAgentToolCallHandler({
      mode: AppMode.IMAGE,
      processingToolCallKeys: new Set<string>(),
      createToolCallId: () => 'tool-1',
      createToolCallKey: () => 'generate_image-sequence-implicit-count',
      upsertLastModelToolCall: vi.fn(),
      updateLastModelMessage: vi.fn(),
      setChatHistory: vi.fn(),
      handleModeSwitch: vi.fn(),
      addToast: vi.fn(),
      handleGenerate,
      normalizeAssistantMode: vi.fn(),
      getPlaybookDefaults: vi.fn().mockReturnValue({}),
      loadAgentJobsByProject: vi.fn().mockResolvedValue([]),
      activeProjectId: 'project-1',
      chatParams: {} as any,
      chatHistory: [],
      chatEditParams: {},
      setRightPanelMode: vi.fn(),
      setThoughtImages: vi.fn(),
      setChatEditParams: vi.fn(),
      setAgentContextAssets: vi.fn(),
      extractSearchContextFromProgress: vi.fn(),
      selectReferenceRecords: vi.fn().mockReturnValue([]),
      latestSearchProgress: undefined,
      compressImageForContext: vi.fn(),
      resolveToolCallRecordStatus: vi.fn().mockReturnValue('success')
    });

    await handler({
      toolName: 'generate_image',
      args: {
        prompt: 'weather anchor sequence',
        sequence_frame_prompts: [
          'Frame 1: anchor introduces today weather.',
          'Frame 2: anchor points to storm cell.',
          'Frame 3: anchor wraps up the segment.'
        ]
      }
    } as AgentAction);

    expect(handleGenerate).toHaveBeenCalledWith(expect.objectContaining({
      numberOfImages: 3,
      sequenceFramePrompts: [
        'Frame 1: anchor introduces today weather.',
        'Frame 2: anchor points to storm cell.',
        'Frame 3: anchor wraps up the segment.'
      ]
    }), expect.any(Object));
  });

  it('rejects mismatched explicit sequence frame prompt counts before generation starts', async () => {
    const addToast = vi.fn();
    const handleGenerate = vi.fn();
    const handler = createAppAgentToolCallHandler({
      mode: AppMode.IMAGE,
      processingToolCallKeys: new Set<string>(),
      createToolCallId: () => 'tool-1',
      createToolCallKey: () => 'generate_image-sequence-mismatch',
      upsertLastModelToolCall: vi.fn(),
      updateLastModelMessage: vi.fn(),
      setChatHistory: vi.fn(),
      handleModeSwitch: vi.fn(),
      addToast,
      handleGenerate,
      normalizeAssistantMode: vi.fn(),
      getPlaybookDefaults: vi.fn().mockReturnValue({}),
      loadAgentJobsByProject: vi.fn().mockResolvedValue([]),
      activeProjectId: 'project-1',
      chatParams: {} as any,
      chatHistory: [],
      chatEditParams: {},
      setRightPanelMode: vi.fn(),
      setThoughtImages: vi.fn(),
      setChatEditParams: vi.fn(),
      setAgentContextAssets: vi.fn(),
      extractSearchContextFromProgress: vi.fn(),
      selectReferenceRecords: vi.fn().mockReturnValue([]),
      latestSearchProgress: undefined,
      compressImageForContext: vi.fn(),
      resolveToolCallRecordStatus: vi.fn().mockReturnValue('failed')
    });

    const result = await handler({
      toolName: 'generate_image',
      args: {
        prompt: 'weather anchor sequence',
        numberOfImages: 2,
        sequence_frame_prompts: [
          'Frame 1: anchor introduces today weather.'
        ]
      }
    } as AgentAction);

    expect(handleGenerate).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.error).toContain('Sequence generation requires 2 explicit frame prompts');
    expect(addToast).toHaveBeenCalled();
  });
});
