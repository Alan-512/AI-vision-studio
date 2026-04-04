import { AspectRatio, ImageModel, ImageResolution, type AgentAction, type ChatMessage, type GenerationParams } from '../types';
import { createGenerateAction, createInitialAgentState, type AgentState, type PendingAction } from './agentService';
import type { ExecuteToolCallsCommand, KernelTransitionResult } from './agentKernelTypes';
import { resolveActiveToolCallMessageTimestamp, type ActiveChatToolCallStatus } from './chatToolCallRuntime';

type RetryControlError = Error & {
  retryable?: boolean;
  lifecycleStatus?: string;
};

export const createGenerateActionExecutor = ({
  onToolCallRef,
  dispatchKernelCommand
}: {
  onToolCallRef: { current?: ((action: AgentAction) => Promise<any> | any) | undefined };
  dispatchKernelCommand?: (command: ExecuteToolCallsCommand) => Promise<Pick<KernelTransitionResult, 'toolResults'>>;
}) => async (action: PendingAction): Promise<any> => {
  if (dispatchKernelCommand && action.type === 'GENERATE_IMAGE') {
    const result = await dispatchKernelCommand({
      type: 'ExecuteToolCalls',
      turnId: 'chat-tool:generate_image',
      toolCalls: [{
        toolName: 'generate_image',
        args: action.params
      }]
    });
    return result.toolResults?.[0];
  }

  if (onToolCallRef.current && action.type === 'GENERATE_IMAGE') {
    const result = await onToolCallRef.current({ toolName: 'generate_image', args: action.params });
    if (result?.status === 'error') {
      const toolError = new Error(result.error || 'Tool execution failed') as RetryControlError;
      if (result.retryable === false) {
        toolError.retryable = false;
      }
      const lifecycleStatus = typeof result.metadata?.lifecycleStatus === 'string'
        ? result.metadata.lifecycleStatus
        : undefined;
      if (lifecycleStatus) {
        toolError.lifecycleStatus = lifecycleStatus;
      }
      throw toolError;
    }
    return result;
  }

  throw new Error(`Unknown action type: ${action.type}`);
};

export const createChatAgentMachine = ({
  onStateChange,
  onToolCallRef,
  dispatchKernelCommand
}: {
  onStateChange: (state: AgentState) => void;
  onToolCallRef: { current?: ((action: AgentAction) => Promise<any> | any) | undefined };
  dispatchKernelCommand?: (command: ExecuteToolCallsCommand) => Promise<Pick<KernelTransitionResult, 'toolResults'>>;
}) => {
  let state = createInitialAgentState();
  const maxRetries = state.maxRetries;
  const executeAction = createGenerateActionExecutor({ onToolCallRef, dispatchKernelCommand });

  const updateState = (updates: Partial<AgentState>) => {
    state = {
      ...state,
      ...updates,
      lastUpdated: Date.now()
    };
    onStateChange(state);
  };

  const executeWithRetry = async (action: PendingAction) => {
    let lastError: any;
    updateState({ retryCount: 0 });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          updateState({ phase: 'EXECUTING' });
        }
        return await executeAction(action);
      } catch (error) {
        lastError = error;
        const retryError = error as RetryControlError;
        const isCancelled = retryError?.lifecycleStatus === 'cancelled'
          || retryError?.message === 'Cancelled by user'
          || retryError?.name === 'AbortError';
        if (retryError?.retryable === false || isCancelled) {
          throw error;
        }

        if (attempt < maxRetries) {
          updateState({
            phase: 'RETRYING',
            retryCount: attempt + 1
          });
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError;
  };

  return {
    getState: () => ({ ...state }),
    setPendingAction: async (action: PendingAction) => {
      updateState({
        phase: 'EXECUTING',
        pendingAction: action,
        error: undefined
      });

      try {
        console.log('[Agent] Auto-executing action (no confirmation required)');
        const result = await executeWithRetry(action);
        const generatedAssetIds = Array.isArray(result?.artifactIds)
          ? result.artifactIds.filter((assetId: unknown): assetId is string => typeof assetId === 'string' && assetId.length > 0)
          : [];

        if (typeof result?.assetId === 'string' && result.assetId.length > 0) {
          generatedAssetIds.push(result.assetId);
        }

        updateState({
          phase: result?.status === 'requires_action' ? 'AWAITING_CONFIRMATION' : 'COMPLETED',
          pendingAction: undefined,
          retryCount: 0,
          context: {
            ...state.context,
            generatedAssets: generatedAssetIds.length > 0
              ? [...new Set([...state.context.generatedAssets, ...generatedAssetIds])]
              : state.context.generatedAssets
          }
        });
      } catch (error: any) {
        updateState({
          phase: 'ERROR',
          pendingAction: undefined,
          retryCount: 0,
          error: `Generation failed: ${error?.message || String(error)}`
        });
        throw error;
      }
    },
    reset: () => {
      state = createInitialAgentState();
      onStateChange(state);
    }
  };
};

export const resolveGenerateActionArgs = (
  actionArgs: Record<string, any>,
  params: GenerationParams
): Record<string, any> => {
  const isAutoMode = params.isAutoMode ?? true;

  if (!isAutoMode) {
    return {
      ...actionArgs,
      model: params.imageModel,
      aspectRatio: params.aspectRatio,
      resolution: params.imageResolution,
      thinkingLevel: params.thinkingLevel,
      negativePrompt: params.negativePrompt || actionArgs.negativePrompt,
      numberOfImages: params.numberOfImages || actionArgs.numberOfImages || 1,
      useGrounding: params.useGrounding ?? actionArgs.useGrounding ?? false
    };
  }

  const finalArgs = { ...actionArgs };
  const validModels = Object.values(ImageModel);
  if (actionArgs.thinkingLevel) {
    finalArgs.thinkingLevel = actionArgs.thinkingLevel;
  }
  if (finalArgs.model && !validModels.includes(finalArgs.model)) {
    finalArgs.model = params.imageModel;
  }
  if (!validModels.includes(finalArgs.model)) {
    finalArgs.model = ImageModel.FLASH_3_1;
  }
  return finalArgs;
};

export const buildActiveGenerateToolCallStatus = (
  finalArgs: Record<string, any>,
  history: ChatMessage[]
): ActiveChatToolCallStatus => {
  let modelName = 'Nano Banana 2';
  if (finalArgs.model === ImageModel.PRO) modelName = 'Nano Banana Pro';
  if (finalArgs.model === ImageModel.FLASH_3_1) modelName = 'Nano Banana 2';
  return {
    isActive: true,
    toolName: 'generate_image',
    model: modelName,
    prompt: finalArgs.prompt || '',
    sourceMessageTimestamp: resolveActiveToolCallMessageTimestamp(history)
  };
};

export const runGenerateActionWithRetry = async ({
  action,
  params,
  history,
  agentMachine,
  setToolCallStatus,
  setToolCallExpanded
}: {
  action: AgentAction;
  params: GenerationParams;
  history: ChatMessage[];
  agentMachine: Pick<ReturnType<typeof createChatAgentMachine>, 'setPendingAction'>;
  setToolCallStatus: (status: ActiveChatToolCallStatus | null) => void;
  setToolCallExpanded: (expanded: boolean) => void;
}): Promise<void> => {
  const finalArgs = resolveGenerateActionArgs(action.args, params);
  const pendingAction = createGenerateAction(
    finalArgs,
    `Generate: ${action.args.prompt?.slice(0, 50)}...`,
    false
  );

  try {
    setToolCallStatus(buildActiveGenerateToolCallStatus(finalArgs, history));
    setToolCallExpanded(false);
    await agentMachine.setPendingAction(pendingAction);
  } finally {
    setToolCallStatus(null);
  }
};

export const createChatAgentRuntimeController = ({
  getParams,
  getHistory,
  agentMachine,
  setToolCallStatus,
  setToolCallExpanded
}: {
  getParams: () => GenerationParams;
  getHistory: () => ChatMessage[];
  agentMachine: Pick<ReturnType<typeof createChatAgentMachine>, 'setPendingAction' | 'reset'>;
  setToolCallStatus: (status: ActiveChatToolCallStatus | null) => void;
  setToolCallExpanded: (expanded: boolean) => void;
}) => ({
  executeGenerateAction: (action: AgentAction) => runGenerateActionWithRetry({
    action,
    params: getParams(),
    history: getHistory(),
    agentMachine,
    setToolCallStatus,
    setToolCallExpanded
  }),
  reset: () => agentMachine.reset()
});

export const createChatAgentRuntimeStore = ({
  getParams,
  getHistory,
  onToolCallRef,
  dispatchKernelCommand,
  setToolCallStatus,
  setToolCallExpanded,
  createMachine = createChatAgentMachine
}: {
  getParams: () => GenerationParams;
  getHistory: () => ChatMessage[];
  onToolCallRef: { current?: ((action: AgentAction) => Promise<any> | any) | undefined };
  dispatchKernelCommand?: (command: ExecuteToolCallsCommand) => Promise<Pick<KernelTransitionResult, 'toolResults'>>;
  setToolCallStatus: (status: ActiveChatToolCallStatus | null) => void;
  setToolCallExpanded: (expanded: boolean) => void;
  createMachine?: (input: {
    onStateChange: (state: AgentState) => void;
    onToolCallRef: { current?: ((action: AgentAction) => Promise<any> | any) | undefined };
    dispatchKernelCommand?: (command: ExecuteToolCallsCommand) => Promise<Pick<KernelTransitionResult, 'toolResults'>>;
  }) => ReturnType<typeof createChatAgentMachine>;
}) => {
  let agentState = createInitialAgentState();
  const listeners = new Set<() => void>();

  const agentMachine = createMachine({
    onStateChange: nextState => {
      agentState = nextState;
      listeners.forEach(listener => listener());
    },
    onToolCallRef,
    dispatchKernelCommand
  });

  const controller = createChatAgentRuntimeController({
    getParams,
    getHistory,
    agentMachine,
    setToolCallStatus,
    setToolCallExpanded
  });

  return {
    getState: () => agentState,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    executeGenerateAction: controller.executeGenerateAction,
    reset: controller.reset
  };
};
