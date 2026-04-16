import type { AgentAction, AgentJob, AgentToolResult, AppMode, ChatMessage, GenerationParams } from '../types';

type PrepareRequestResult = {
  userKey: string;
  activeParams: GenerationParams;
  currentProjectId: string;
  currentMode: AppMode;
  resolvedJobSource: AgentJob['source'];
  triggerMessageTimestamp?: number;
};

type BuildTaskFlowDepsBuilderInput = {
  currentMode: AppMode;
  activeParams: GenerationParams;
  userKey: string;
  toolCall?: AgentAction;
  historyOverride?: ChatMessage[];
};

type AppHandleGenerateOptions = {
  generationSurface?: 'quick' | 'assistant';
  modeOverride?: AppMode;
  onPreview?: (asset: any) => void;
  onSuccess?: (asset: any) => void;
  historyOverride?: ChatMessage[];
  useParamsAsBase?: boolean;
  jobSource?: AgentJob['source'];
  toolCall?: AgentAction;
  selectedReferenceRecords?: any[];
  searchContextOverride?: AgentJob['searchContext'];
  resumeJobId?: string;
  resumeActionType?: string;
};

export const createAppHandleGenerate = ({
  prepareRequest,
  buildTaskFlowDepsBuilder,
  executeGenerationFlow,
  getProjectName,
  computeHistoryForGeneration
}: {
  prepareRequest: (
    fullParams: GenerationParams,
    options?: AppHandleGenerateOptions
  ) => Promise<PrepareRequestResult | null>;
  buildTaskFlowDepsBuilder: (input: BuildTaskFlowDepsBuilderInput) => () => unknown;
  executeGenerationFlow: (input: any) => Promise<AgentToolResult[]>;
  getProjectName: (projectId: string) => string;
  computeHistoryForGeneration: (input: {
    currentMode: AppMode;
    activeParams: GenerationParams;
    historyOverride?: ChatMessage[];
  }) => ChatMessage[] | undefined;
}) => async (
  fullParams: GenerationParams,
  options?: AppHandleGenerateOptions,
  context?: {
    launchControllerInput: any;
    createGenerationTaskLaunchController: (input: any) => any;
    executeAppGenerationRequest: (input: any) => Promise<any>;
    dispatchKernelCommand?: (command: any) => Promise<any>;
    createSessionInput: {
      createResumeActionStep: any;
      buildConsistencyProfile: any;
      normalizeAssistantMode: (value: unknown) => unknown;
      prepareGenerationLaunch: any;
    };
    playSuccessSound?: () => void;
  }
): Promise<AgentToolResult[]> => {
  const preflight = await prepareRequest(fullParams, options);
  if (!preflight) return [];

  const {
    userKey,
    activeParams,
    currentProjectId,
    currentMode,
    resolvedJobSource,
    triggerMessageTimestamp
  } = preflight;

  const createTaskFlowDepsBuilder = buildTaskFlowDepsBuilder({
    currentMode,
    activeParams,
    userKey,
    toolCall: options?.toolCall,
    historyOverride: options?.historyOverride
  });

  return executeGenerationFlow({
    launchControllerInput: context?.launchControllerInput,
    requestInput: {
      count: activeParams.numberOfImages || 1,
      generationSurface: options?.generationSurface ?? 'assistant',
      currentProjectId,
      currentMode,
      activeParams,
      resolvedJobSource,
      triggerMessageTimestamp,
      searchContextOverride: options?.searchContextOverride,
      selectedReferenceRecords: options?.selectedReferenceRecords || [],
      resumeJobId: options?.resumeJobId,
      resumeActionType: options?.resumeActionType,
      toolCall: options?.toolCall,
      historyForGeneration: computeHistoryForGeneration({
        currentMode,
        activeParams,
        historyOverride: options?.historyOverride
      }),
      projectName: getProjectName(currentProjectId),
      createSessionInput: context?.createSessionInput,
      createTaskFlowDepsBuilder,
      playSuccessSound: context?.playSuccessSound
    },
    createGenerationTaskLaunchController: context?.createGenerationTaskLaunchController,
    executeAppGenerationRequest: context?.executeAppGenerationRequest,
    dispatchKernelCommand: context?.dispatchKernelCommand
  });
};
