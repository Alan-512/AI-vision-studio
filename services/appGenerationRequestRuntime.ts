import type { AgentJob, AgentToolResult, GenerationParams } from '../types';
import { launchAppGenerationTasks } from './appGenerationTaskLauncherRuntime';
import { buildSequenceFramePrompts } from './toolboxRuntime';

const SINGLE_FRAME_SEQUENCE_GUARDRAIL = 'Render exactly one standalone frame. Do not create a collage, grid, split-screen, diptych, triptych, storyboard, contact sheet, or multiple panels. Show a single continuous camera shot only.';

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
}) => {
  const sequenceFramePrompts = buildSequenceFramePrompts({
    basePrompt: activeParams.prompt,
    count,
    framePrompts: activeParams.sequenceFramePrompts
  });

  return launchAppGenerationTasks({
    count,
    createLaunchInput: index => index,
    launchPreparedTask: async (index: number) => {
      const normalizedPrompt = sequenceFramePrompts[index] || activeParams.prompt;
      const guardedPrompt = count > 1
        ? `${normalizedPrompt}\n\n${SINGLE_FRAME_SEQUENCE_GUARDRAIL}`
        : normalizedPrompt;
      console.log('[AppGenerationRequest] sequence frame prompt:', {
        frameIndex: index,
        frameCount: count,
        originalFramePrompt: normalizedPrompt,
        finalFramePrompt: guardedPrompt
      });
      const taskParams: GenerationParams = {
        ...activeParams,
        prompt: guardedPrompt,
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
          activeParams: taskParams,
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
};
