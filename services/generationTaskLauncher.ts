import type { AgentAction, AgentJob, AgentToolResult, GenerationParams } from '../types';

export const createGenerationTaskLauncher = ({
  deps
}: {
  deps: {
    loadExistingJob: (projectId: string, resumeJobId?: string) => Promise<AgentJob | undefined>;
    getPreviousTaskIds: (jobId: string) => string[];
    createTaskSession: (input: any) => Promise<{
      taskId: string;
      jobId: string;
      stepId: string;
      initialPendingAsset: any;
      taskRuntime: any;
      getAgentJob: () => AgentJob;
    }>;
    executePreparedGenerationTask: (input: any) => Promise<AgentToolResult>;
    createAbortController: () => AbortController;
    registerController: (taskId: string, controller: AbortController) => void;
    unregisterController: (taskId: string) => void;
  };
}) => async ({
  currentProjectId,
  currentMode,
  activeParams,
  resolvedJobSource,
  triggerMessageTimestamp,
  searchContextOverride,
  selectedReferenceRecords,
  resumeJobId,
  resumeActionType,
  toolCall,
  historyForGeneration,
  createSessionInput,
  buildTaskRuntimeDeps
}: {
  currentProjectId: string;
  currentMode: any;
  activeParams: GenerationParams;
  resolvedJobSource: AgentJob['source'];
  triggerMessageTimestamp?: number;
  searchContextOverride?: AgentJob['searchContext'];
  selectedReferenceRecords: unknown[];
  resumeJobId?: string;
  resumeActionType?: string;
  toolCall?: AgentAction;
  historyForGeneration?: unknown;
  buildTaskRuntimeDeps?: (input: any) => any;
  createSessionInput: {
    projectName: string;
    createResumeActionStep: (stepId: string, jobId: string, prompt: string, actionType?: string) => any;
    buildConsistencyProfile: (
      assistantMode: unknown,
      selectedReferences: unknown[],
      searchContext?: AgentJob['searchContext'],
      existing?: AgentJob['consistencyProfile']
    ) => AgentJob['consistencyProfile'];
    normalizeAssistantMode: (value: unknown) => unknown;
    prepareGenerationLaunch: (input: any) => {
      pendingAsset: any;
      queuedJob: AgentJob;
    };
  };
}): Promise<AgentToolResult> => {
  const controller = deps.createAbortController();
  const existingJob = await deps.loadExistingJob(currentProjectId, resumeJobId);
  const previousTaskIds = resumeJobId ? deps.getPreviousTaskIds(resumeJobId) : [];
  const session = await deps.createTaskSession({
    currentProjectId,
    currentMode,
    projectName: createSessionInput.projectName,
    resolvedJobSource,
    triggerMessageTimestamp,
    activePrompt: activeParams.prompt,
    searchContextOverride,
    selectedReferenceRecords,
    existingJob,
    previousTaskIds,
    params: activeParams,
    toolCall,
    resumeJobId,
    resumeActionType,
    createResumeActionStep: createSessionInput.createResumeActionStep,
    buildConsistencyProfile: createSessionInput.buildConsistencyProfile,
    normalizeAssistantMode: createSessionInput.normalizeAssistantMode,
    prepareGenerationLaunch: createSessionInput.prepareGenerationLaunch
  });

  deps.registerController(session.taskId, controller);
  try {
    return await deps.executePreparedGenerationTask({
      mode: currentMode,
      agentJob: session.getAgentJob(),
      stepId: session.stepId,
      taskId: session.taskId,
      jobId: session.jobId,
      currentProjectId,
      activeParams,
      initialPendingAsset: session.initialPendingAsset,
      signal: controller.signal,
      selectedReferenceRecords,
      historyForGeneration,
      taskRuntime: session.taskRuntime,
      getAgentJob: session.getAgentJob,
      buildTaskRuntimeDeps
    });
  } finally {
    deps.unregisterController(session.taskId);
  }
};
