import type { AgentJob, AgentToolResult, GenerationParams } from '../types';
import { launchAppGenerationTasks } from './appGenerationTaskLauncherRuntime';

export const executeAppGenerationRequest = async ({
  count,
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
  projectName,
  createSessionInput,
  createTaskFlowDepsBuilder,
  launchPreparedTask,
  playSuccessSound
}: {
  count: number;
  currentProjectId: string;
  currentMode: any;
  activeParams: GenerationParams;
  resolvedJobSource: AgentJob['source'];
  triggerMessageTimestamp?: number;
  searchContextOverride?: AgentJob['searchContext'];
  selectedReferenceRecords: unknown[];
  resumeJobId?: string;
  resumeActionType?: string;
  toolCall?: any;
  historyForGeneration?: any;
  projectName: string;
  createSessionInput: {
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
  createTaskFlowDepsBuilder: () => (runtimeInput: any) => any;
  launchPreparedTask: (input: any) => Promise<AgentToolResult>;
  playSuccessSound: () => void;
}) => launchAppGenerationTasks({
  count,
  createLaunchInput: index => index,
  launchPreparedTask: async (_index: number) => {
    const taskParams: GenerationParams = {
      ...activeParams,
      numberOfImages: 1
    };
    const latestVisibleAssetRef = { current: null as any };
    const taskMarkedVisibleCompleteRef = { current: false };
    let successSoundPlayed = false;
    const playVisibleSuccess = () => {
      if (successSoundPlayed) return;
      successSoundPlayed = true;
      playSuccessSound();
    };

    const buildTaskRuntimeDeps = createTaskFlowDepsBuilder();

    return launchPreparedTask({
      currentProjectId,
      currentMode,
      activeParams: taskParams,
      resolvedJobSource,
      triggerMessageTimestamp,
      searchContextOverride,
      selectedReferenceRecords,
      resumeJobId,
      resumeActionType,
      toolCall,
      historyForGeneration,
      createSessionInput: {
        ...createSessionInput,
        projectName
      },
      buildTaskRuntimeDeps: ({
        taskRuntime,
        getAgentJob,
        stepId,
        taskId,
        jobId,
        currentProjectId,
        activeParams: taskParams,
        initialPendingAsset,
        signal,
        selectedReferenceRecords,
        historyForGeneration
      }: any) => buildTaskRuntimeDeps({
        taskRuntime,
        getAgentJob,
        stepId,
        taskId,
        jobId,
        currentProjectId,
        activeParams,
        initialPendingAsset,
        signal,
        selectedReferenceRecords,
        historyForGeneration,
        latestVisibleAssetRef,
        taskMarkedVisibleCompleteRef,
        playVisibleSuccess
      })
    });
  }
});
