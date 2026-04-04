import { describe, expect, it, vi } from 'vitest';
import { AppMode, AspectRatio, ImageModel, ImageResolution, type AgentAction, type ChatMessage, type GenerationParams } from '../types';
import {
  buildActiveGenerateToolCallStatus,
  createChatAgentRuntimeController,
  createChatAgentMachine,
  createChatAgentRuntimeStore,
  createGenerateActionExecutor,
  resolveGenerateActionArgs,
  runGenerateActionWithRetry
} from '../services/chatAgentRuntime';

const createParams = (overrides: Partial<GenerationParams> = {}): GenerationParams => ({
  prompt: '',
  savedImagePrompt: '',
  savedVideoPrompt: '',
  aspectRatio: AspectRatio.SQUARE,
  imageModel: ImageModel.FLASH_3_1,
  imageStyle: undefined as any,
  imageResolution: ImageResolution.RES_1K,
  videoModel: undefined as any,
  videoStyle: undefined as any,
  videoResolution: undefined as any,
  videoDuration: undefined as any,
  useGrounding: false,
  searchPolicy: undefined as any,
  smartAssets: [],
  isAutoMode: true,
  ...overrides
});

describe('chatAgentRuntime', () => {
  it('overrides AI-selected generate args with manual params in manual mode', () => {
    const resolved = resolveGenerateActionArgs({
      prompt: 'ai prompt',
      model: ImageModel.PRO,
      aspectRatio: AspectRatio.LANDSCAPE,
      resolution: ImageResolution.RES_2K,
      thinkingLevel: 'high',
      numberOfImages: 4,
      useGrounding: true
    }, createParams({
      isAutoMode: false,
      imageModel: ImageModel.FLASH_3_1,
      aspectRatio: AspectRatio.PORTRAIT,
      imageResolution: ImageResolution.RES_1K,
      thinkingLevel: 'medium' as any,
      negativePrompt: 'avoid blur',
      numberOfImages: 2,
      useGrounding: false
    }));

    expect(resolved.model).toBe(ImageModel.FLASH_3_1);
    expect(resolved.aspectRatio).toBe(AspectRatio.PORTRAIT);
    expect(resolved.resolution).toBe(ImageResolution.RES_1K);
    expect(resolved.negativePrompt).toBe('avoid blur');
    expect(resolved.numberOfImages).toBe(2);
    expect(resolved.useGrounding).toBe(false);
  });

  it('builds active tool call status from resolved generate args and history', () => {
    const history: ChatMessage[] = [{
      role: 'user',
      content: 'make a poster',
      timestamp: 1710000000000
    }, {
      role: 'model',
      content: 'I will generate that now.',
      timestamp: 1710000000001
    }];

    const status = buildActiveGenerateToolCallStatus({
      prompt: 'poster prompt',
      model: ImageModel.PRO
    }, history);

    expect(status).toMatchObject({
      isActive: true,
      toolName: 'generate_image',
      model: 'Nano Banana Pro',
      prompt: 'poster prompt',
      sourceMessageTimestamp: 1710000000001
    });
  });

  it('runs generate action through the agent machine and clears tool status afterwards', async () => {
    const setToolCallStatus = vi.fn();
    const setToolCallExpanded = vi.fn();
    const setPendingAction = vi.fn().mockResolvedValue(undefined);
    const action: AgentAction = {
      toolName: 'generate_image',
      args: {
        prompt: 'poster prompt',
        model: ImageModel.FLASH_3_1
      }
    };

    await runGenerateActionWithRetry({
      action,
      params: createParams(),
      history: [],
      agentMachine: { setPendingAction } as any,
      setToolCallStatus,
      setToolCallExpanded
    });

    expect(setPendingAction).toHaveBeenCalledTimes(1);
    expect(setToolCallExpanded).toHaveBeenCalledWith(false);
    expect(setToolCallStatus).toHaveBeenNthCalledWith(1, expect.objectContaining({
      isActive: true,
      toolName: 'generate_image'
    }));
    expect(setToolCallStatus).toHaveBeenLastCalledWith(null);
  });

  it('normalizes tool execution errors from onToolCall results', async () => {
    const executeAction = createGenerateActionExecutor({
      onToolCallRef: {
        current: vi.fn().mockResolvedValue({
          status: 'error',
          error: 'Tool execution failed',
          retryable: false,
          metadata: {
            lifecycleStatus: 'failed'
          }
        })
      }
    });

    await expect(executeAction({
      type: 'GENERATE_IMAGE',
      params: { prompt: 'poster' },
      description: 'Generate poster',
      requiresConfirmation: false
    })).rejects.toMatchObject({
      message: 'Tool execution failed',
      retryable: false,
      lifecycleStatus: 'failed'
    });
  });

  it('dispatches generate actions through kernel ExecuteToolCalls when provided', async () => {
    const dispatchKernelCommand = vi.fn().mockResolvedValue({
      toolResults: [{
        status: 'success',
        toolName: 'generate_image',
        jobId: 'job-1'
      }]
    });
    const executeAction = createGenerateActionExecutor({
      onToolCallRef: { current: vi.fn() },
      dispatchKernelCommand
    });

    const result = await executeAction({
      type: 'GENERATE_IMAGE',
      params: { prompt: 'poster' },
      description: 'Generate poster',
      requiresConfirmation: false
    });

    expect(dispatchKernelCommand).toHaveBeenCalledWith({
      type: 'ExecuteToolCalls',
      turnId: 'chat-tool:generate_image',
      toolCalls: [{
        toolName: 'generate_image',
        args: { prompt: 'poster' }
      }]
    });
    expect(result).toEqual({
      status: 'success',
      toolName: 'generate_image',
      jobId: 'job-1'
    });
  });

  it('creates a chat agent machine that emits state updates', async () => {
    const onStateChange = vi.fn();
    const machine = createChatAgentMachine({
      onStateChange,
      onToolCallRef: {
        current: vi.fn().mockResolvedValue({
          status: 'success',
          artifactIds: ['asset-1']
        })
      }
    });

    await machine.setPendingAction({
      type: 'GENERATE_IMAGE',
      params: { prompt: 'poster' },
      description: 'Generate poster',
      requiresConfirmation: false
    });

    expect(onStateChange).toHaveBeenCalled();
    expect(machine.getState().phase).toBe('COMPLETED');
    expect(machine.getState().context.generatedAssets).toContain('asset-1');
  });

  it('rethrows failed generate actions after updating error state', async () => {
    const onStateChange = vi.fn();
    const machine = createChatAgentMachine({
      onStateChange,
      onToolCallRef: {
        current: vi.fn().mockResolvedValue({
          status: 'error',
          error: 'Tool execution failed',
          retryable: false
        })
      }
    });

    await expect(machine.setPendingAction({
      type: 'GENERATE_IMAGE',
      params: { prompt: 'poster' },
      description: 'Generate poster',
      requiresConfirmation: false
    })).rejects.toMatchObject({
      message: 'Tool execution failed'
    });
    expect(machine.getState().phase).toBe('ERROR');
    expect(machine.getState().error).toContain('Tool execution failed');
  });

  it('creates a runtime controller that can execute and reset the agent machine', async () => {
    const setToolCallStatus = vi.fn();
    const setToolCallExpanded = vi.fn();
    const reset = vi.fn();
    const setPendingAction = vi.fn().mockResolvedValue(undefined);
    const controller = createChatAgentRuntimeController({
      getParams: () => createParams(),
      getHistory: () => [],
      agentMachine: {
        setPendingAction,
        reset
      } as any,
      setToolCallStatus,
      setToolCallExpanded
    });

    await controller.executeGenerateAction({
      toolName: 'generate_image',
      args: {
        prompt: 'poster prompt',
        model: ImageModel.FLASH_3_1
      }
    });
    controller.reset();

    expect(setPendingAction).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('creates a runtime store that publishes state updates and proxies controller actions', async () => {
    const listeners: Array<(state: any) => void> = [];
    const machine = {
      setPendingAction: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(() => {
        listeners.forEach(listener => listener({
          phase: 'IDLE',
          retryCount: 0,
          maxRetries: 3,
          error: null,
          pendingAction: null,
          context: {
            generatedAssets: []
          }
        }));
      })
    };

    const store = createChatAgentRuntimeStore({
      getParams: () => createParams(),
      getHistory: () => [],
      onToolCallRef: { current: undefined },
      setToolCallStatus: vi.fn(),
      setToolCallExpanded: vi.fn(),
      createMachine: ({ onStateChange }) => {
        listeners.push(onStateChange);
        return machine as any;
      }
    });

    const seenStates: string[] = [];
    const unsubscribe = store.subscribe(() => {
      seenStates.push(store.getState().phase);
    });

    listeners.forEach(listener => listener({
      phase: 'RETRYING',
      retryCount: 1,
      maxRetries: 3,
      error: 'retry',
      pendingAction: null,
      context: {
        generatedAssets: []
      }
    }));

    await store.executeGenerateAction({
      toolName: 'generate_image',
      args: {
        prompt: 'poster prompt',
        model: ImageModel.FLASH_3_1
      }
    });
    store.reset();
    unsubscribe();

    expect(seenStates).toContain('RETRYING');
    expect(machine.setPendingAction).toHaveBeenCalledTimes(1);
    expect(machine.reset).toHaveBeenCalledTimes(1);
    expect(store.getState().phase).toBe('IDLE');
  });
});
