import type { AgentAction, AgentJob, AssetItem, BackgroundTaskView, GenerationParams } from '../types';

export const createGenerationTaskSession = async ({
  currentProjectId,
  currentMode,
  projectName,
  resolvedJobSource,
  triggerMessageTimestamp,
  activePrompt,
  searchContextOverride,
  selectedReferenceRecords,
  existingJob,
  previousTaskIds,
  params,
  toolCall,
  resumeJobId,
  resumeActionType,
  createResumeActionStep,
  buildConsistencyProfile,
  normalizeAssistantMode,
  prepareGenerationLaunch,
  createTaskRuntime,
  now = () => Date.now(),
  createId = () => crypto.randomUUID()
}: {
  currentProjectId: string;
  currentMode: any;
  projectName: string;
  resolvedJobSource: AgentJob['source'];
  triggerMessageTimestamp?: number;
  activePrompt: string;
  searchContextOverride?: AgentJob['searchContext'];
  selectedReferenceRecords: unknown[];
  existingJob?: AgentJob;
  previousTaskIds: string[];
  params: GenerationParams;
  toolCall?: AgentAction;
  resumeJobId?: string;
  resumeActionType?: string;
  createResumeActionStep: (stepId: string, jobId: string, prompt: string, actionType?: string) => any;
  buildConsistencyProfile: (
    assistantMode: unknown,
    selectedReferences: unknown[],
    searchContext?: AgentJob['searchContext'],
    existing?: AgentJob['consistencyProfile']
  ) => AgentJob['consistencyProfile'];
  normalizeAssistantMode: (value: unknown) => unknown;
  prepareGenerationLaunch: (input: any) => {
    pendingAsset: AssetItem;
    queuedJob: AgentJob;
  };
  createTaskRuntime: (input: {
    taskId: string;
    currentProjectId: string;
    projectName: string;
    fallbackPrompt: string;
    agentJob: AgentJob;
    onPersist: (job: AgentJob) => void;
  }) => any;
  now?: () => number;
  createId?: () => string;
}) => {
  const taskId = createId();
  const jobId = resumeJobId || taskId;
  const stepId = createId();
  const resumeStepId = resumeJobId ? createId() : undefined;
  const assistantMode = normalizeAssistantMode((params as any).assistant_mode || toolCall?.args?.assistant_mode);
  const consistencyProfile = buildConsistencyProfile(
    assistantMode,
    selectedReferenceRecords,
    searchContextOverride,
    existingJob?.consistencyProfile
  );
  const { pendingAsset: initialPendingAsset, queuedJob } = prepareGenerationLaunch({
    taskId,
    jobId,
    stepId,
    projectId: currentProjectId,
    mode: currentMode,
    now: now(),
    source: resolvedJobSource,
    triggerMessageTimestamp,
    consistencyProfile,
    searchContext: searchContextOverride,
    params,
    toolCall,
    selectedReferenceRecords,
    existingJob,
    resumeActionStep: resumeStepId ? createResumeActionStep(resumeStepId, jobId, activePrompt, resumeActionType) : undefined
  });

  let agentJob = queuedJob;
  const taskRuntime = createTaskRuntime({
    taskId,
    currentProjectId,
    projectName,
    fallbackPrompt: activePrompt,
    agentJob,
    onPersist: job => {
      agentJob = job;
    }
  });

  if (previousTaskIds.length > 0) {
    Promise.all(previousTaskIds.map(previousTaskId => taskRuntime.dismissTaskView(previousTaskId))).catch(console.error);
  }
  taskRuntime.initializeQueuedJob(agentJob).catch(console.error);

  return {
    taskId,
    jobId,
    stepId,
    resumeStepId,
    initialPendingAsset,
    getAgentJob: () => agentJob,
    agentJob,
    taskRuntime
  };
};
