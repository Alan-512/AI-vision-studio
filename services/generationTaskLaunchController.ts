import type { AgentJob, AgentToolResult } from '../types';
import { createGenerationTaskLauncher } from './generationTaskLauncher';
import { executePreparedGenerationTask as executePreparedGenerationTaskFlow } from './generationTaskFlowRuntime';
import { createGenerationTaskRuntimeController } from './generationTaskRuntime';
import { createGenerationTaskSession } from './generationTaskSessionRuntime';

export const createGenerationTaskLaunchController = ({
  persistenceDeps,
  launcherDeps,
  runtimeDeps
}: {
  persistenceDeps: {
    taskViewsRef: { current: any[] };
    setTaskViews: (taskViews: any[]) => void;
    saveTaskView: (taskView: any) => Promise<void>;
    deleteTaskView: (taskId: string) => Promise<void>;
    activeProjectIdRef: { current: string | null };
    setAssets: (updater: (assets: any[]) => any[]) => void;
    saveAsset: (asset: any) => Promise<void>;
    updateAsset?: (assetId: string, updates: any) => Promise<void>;
    deleteAssetPermanently?: (assetId: string) => Promise<void>;
    saveAgentJobSnapshot: (job: AgentJob) => Promise<void>;
    onPreview?: (asset: any) => void;
    onSuccess?: (asset: any) => Promise<void> | void;
  };
  launcherDeps: {
    loadExistingJob: (projectId: string, resumeJobId?: string) => Promise<AgentJob | undefined>;
    getPreviousTaskIds: (jobId: string) => string[];
    createAbortController: () => AbortController;
    registerController: (taskId: string, controller: AbortController) => void;
    unregisterController: (taskId: string) => void;
  };
  runtimeDeps: {
    now?: () => number;
    createId?: () => string;
    executePreparedGenerationTask?: typeof executePreparedGenerationTaskFlow;
  };
}) => createGenerationTaskLauncher({
  deps: {
    loadExistingJob: launcherDeps.loadExistingJob,
    getPreviousTaskIds: launcherDeps.getPreviousTaskIds,
    createTaskSession: input => createGenerationTaskSession({
      ...input,
      createTaskRuntime: ({ taskId, currentProjectId, projectName, fallbackPrompt, agentJob, onPersist }) => {
        const agentJobRef = { current: agentJob };
        return createGenerationTaskRuntimeController({
          jobRuntime: {
            jobRef: agentJobRef,
            saveAgentJobSnapshot: persistenceDeps.saveAgentJobSnapshot,
            onPersist
          },
          taskRuntime: {
            options: {
              projectName,
              fallbackPrompt,
              viewId: taskId
            },
            deps: {
              taskViewsRef: persistenceDeps.taskViewsRef,
              setTaskViews: persistenceDeps.setTaskViews,
              saveTaskView: persistenceDeps.saveTaskView,
              deleteTaskView: persistenceDeps.deleteTaskView
            }
          },
          assetRuntime: {
            options: {
              taskId,
              currentProjectId
            },
            deps: {
              activeProjectIdRef: persistenceDeps.activeProjectIdRef,
              setAssets: persistenceDeps.setAssets,
              saveAsset: persistenceDeps.saveAsset,
              updateAsset: persistenceDeps.updateAsset,
              deleteAssetPermanently: persistenceDeps.deleteAssetPermanently,
              onPreview: persistenceDeps.onPreview,
              onSuccess: persistenceDeps.onSuccess
            }
          }
        });
      },
      now: runtimeDeps.now,
      createId: runtimeDeps.createId
    }),
    executePreparedGenerationTask: input => {
      const executePreparedGenerationTaskImpl = runtimeDeps.executePreparedGenerationTask || executePreparedGenerationTaskFlow;
      const {
        mode,
        agentJob,
        stepId,
        taskId,
        jobId,
        currentProjectId,
        activeParams,
        initialPendingAsset,
        signal,
        selectedReferenceRecords,
        historyForGeneration,
        buildTaskRuntimeDeps,
        taskRuntime,
        getAgentJob
      } = input;

      return executePreparedGenerationTaskImpl({
        mode,
        agentJob,
        stepId,
        taskId,
        jobId,
        currentProjectId,
        activeParams,
        initialPendingAsset,
        signal,
        selectedReferenceRecords,
        historyForGeneration,
        deps: buildTaskRuntimeDeps({
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
          historyForGeneration
        })
      });
    },
    createAbortController: launcherDeps.createAbortController,
    registerController: launcherDeps.registerController,
    unregisterController: launcherDeps.unregisterController
  }
});
