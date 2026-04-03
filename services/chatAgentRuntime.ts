import { AspectRatio, ImageModel, ImageResolution, type AgentAction, type ChatMessage, type GenerationParams } from '../types';
import { AgentStateMachine, createGenerateAction, createInitialAgentState, type AgentState, type AgentStateMachine as AgentStateMachineType, type PendingAction } from './agentService';
import { resolveActiveToolCallMessageTimestamp, type ActiveChatToolCallStatus } from './chatToolCallRuntime';

type RetryControlError = Error & {
  retryable?: boolean;
  lifecycleStatus?: string;
};

export const createGenerateActionExecutor = ({
  onToolCallRef
}: {
  onToolCallRef: { current?: ((action: AgentAction) => Promise<any> | any) | undefined };
}) => async (action: PendingAction): Promise<any> => {
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
  onToolCallRef
}: {
  onStateChange: (state: AgentState) => void;
  onToolCallRef: { current?: ((action: AgentAction) => Promise<any> | any) | undefined };
}): AgentStateMachineType => new AgentStateMachine(
  createInitialAgentState(),
  {
    onStateChange,
    onExecuteAction: createGenerateActionExecutor({ onToolCallRef })
  }
);

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
  agentMachine: Pick<AgentStateMachineType, 'setPendingAction'>;
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
  agentMachine: Pick<AgentStateMachineType, 'setPendingAction' | 'reset'>;
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
  setToolCallStatus,
  setToolCallExpanded,
  createMachine = createChatAgentMachine
}: {
  getParams: () => GenerationParams;
  getHistory: () => ChatMessage[];
  onToolCallRef: { current?: ((action: AgentAction) => Promise<any> | any) | undefined };
  setToolCallStatus: (status: ActiveChatToolCallStatus | null) => void;
  setToolCallExpanded: (expanded: boolean) => void;
  createMachine?: (input: {
    onStateChange: (state: AgentState) => void;
    onToolCallRef: { current?: ((action: AgentAction) => Promise<any> | any) | undefined };
  }) => AgentStateMachineType;
}) => {
  let agentState = createInitialAgentState();
  const listeners = new Set<() => void>();

  const agentMachine = createMachine({
    onStateChange: nextState => {
      agentState = nextState;
      listeners.forEach(listener => listener());
    },
    onToolCallRef
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
