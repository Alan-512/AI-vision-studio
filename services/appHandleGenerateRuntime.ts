import type { AgentToolResult, GenerationParams } from '../types';

export const createAppHandleGenerate = ({
  prepareRequest,
  buildTaskFlowDepsBuilder,
  executeGenerationFlow,
  getProjectName,
  computeHistoryForGeneration
}: {
  prepareRequest: (fullParams: GenerationParams, options?: Record<string, unknown>) => Promise<any>;
  buildTaskFlowDepsBuilder: (input: {
    currentMode: any;
    activeParams: any;
    userKey: string;
    toolCall?: unknown;
    historyOverride?: unknown;
  }) => () => unknown;
  executeGenerationFlow: (input: any) => Promise<AgentToolResult[]>;
  getProjectName: (projectId: string) => string;
  computeHistoryForGeneration: (input: {
    currentMode: any;
    activeParams: any;
    historyOverride?: any;
  }) => any;
}) => async (
  fullParams: GenerationParams,
  options?: {
    modeOverride?: any;
    onPreview?: (asset: any) => void;
    onSuccess?: (asset: any) => void;
    historyOverride?: any;
    useParamsAsBase?: boolean;
    jobSource?: any;
    toolCall?: any;
    selectedReferenceRecords?: any[];
    searchContextOverride?: any;
    resumeJobId?: string;
    resumeActionType?: string;
  },
  context?: {
    launchControllerInput: any;
    createGenerationTaskLaunchController: (input: any) => any;
    executeAppGenerationRequest: (input: any) => Promise<any>;
    dispatchKernelCommand?: (command: any) => Promise<any>;
    createSessionInput: {
      createResumeActionStep: any;
      buildConsistencyProfile: any;
      normalizeAssistantMode: any;
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
