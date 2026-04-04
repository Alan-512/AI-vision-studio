import type { AgentJob, AssetItem, BackgroundTaskView } from '../types';
import { createAgentJobSnapshotPersister } from './agentJobPersistence';
import { createAssetProjectionController } from './assetProjectionPersistence';
import {
  buildAssetProducedEvents,
  buildCancelJobEvents,
  buildCompletedJobEvents,
  buildFailedJobEvents,
  buildReviewResolutionEvents,
  buildReviewStartedEvents,
  buildStepStartedEvents
} from './jobCommandEventRuntime';
import { createTaskViewProjectionController } from './taskProjectionPersistence';

export const createGenerationTaskRuntimeController = ({
  jobRuntime,
  taskRuntime,
  assetRuntime
}: {
  jobRuntime: {
    jobRef: { current: AgentJob };
    saveAgentJobSnapshot: (job: AgentJob) => Promise<void>;
    onPersist?: (job: AgentJob) => void;
  };
  taskRuntime: {
    options: {
      projectName: string;
      fallbackPrompt: string;
      viewId: string;
    };
    deps: {
      taskViewsRef: { current: BackgroundTaskView[] };
      setTaskViews: (taskViews: BackgroundTaskView[]) => void;
      saveTaskView: (taskView: BackgroundTaskView) => Promise<void>;
      deleteTaskView: (taskId: string) => Promise<void>;
    };
  };
  assetRuntime: {
    options: {
      taskId: string;
      currentProjectId: string;
    };
    deps: {
      activeProjectIdRef: { current: string | null };
      setAssets: (updater: (assets: AssetItem[]) => AssetItem[]) => void;
      saveAsset: (asset: AssetItem) => Promise<void>;
      updateAsset?: (assetId: string, updates: Partial<AssetItem>) => Promise<void>;
      deleteAssetPermanently?: (assetId: string) => Promise<void>;
      onPreview?: (asset: AssetItem) => void;
      onSuccess?: (asset: AssetItem) => Promise<void> | void;
    };
  };
}) => {
  const persistJob = createAgentJobSnapshotPersister({
    jobRef: jobRuntime.jobRef,
    saveAgentJobSnapshot: jobRuntime.saveAgentJobSnapshot
  }, {
    onPersist: jobRuntime.onPersist
  });
  const taskView = createTaskViewProjectionController(taskRuntime);
  const asset = createAssetProjectionController(assetRuntime);

  return {
    persistJob,
    persistJobs: async (jobs: AgentJob[]) => Promise.all(jobs.map(job => persistJob(job))),
    syncJob: async (
      job: AgentJob,
      options?: {
        taskView?: 'none' | 'upsert' | 'visible_complete';
      }
    ) => {
      const persisted = await persistJob(job);
      if (options?.taskView === 'upsert') {
        await taskView.upsertForJob(persisted);
      }
      if (options?.taskView === 'visible_complete') {
        await taskView.markVisibleComplete(persisted);
      }
      return persisted;
    },
    syncSurfaceJob: (job: AgentJob, shouldSyncTaskView: boolean) => persistJob(job).then(async persisted => {
      if (shouldSyncTaskView) {
        await taskView.upsertForJob(persisted);
      }
      return persisted;
    }),
    startReview: (job: AgentJob, shouldSyncTaskView: boolean) => persistJob(job).then(async persisted => {
      if (shouldSyncTaskView) {
        await taskView.upsertForJob(persisted);
      }
      return {
        job: persisted,
        events: buildReviewStartedEvents({
          job: persisted,
          timestamp: persisted.updatedAt
        })
      };
    }),
    startAutoRevision: async (jobs: AgentJob[]) => Promise.all(jobs.map(async job => {
      const persisted = await persistJob(job);
      return {
        job: persisted,
        events: buildReviewStartedEvents({
          job: persisted,
          timestamp: persisted.updatedAt
        })
      };
    })),
    resolvePrimaryReview: (job: AgentJob, shouldSyncTaskView: boolean) => persistJob(job).then(async persisted => {
      if (shouldSyncTaskView) {
        await taskView.upsertForJob(persisted);
      }
      return {
        job: persisted,
        events: buildReviewResolutionEvents({
          job: persisted,
          timestamp: persisted.updatedAt,
          resolution: persisted.status === 'completed' ? 'completed' : 'requires_action'
        })
      };
    }),
    resolveAutoRevision: (job: AgentJob, shouldSyncTaskView: boolean) => persistJob(job).then(async persisted => {
      if (shouldSyncTaskView) {
        await taskView.upsertForJob(persisted);
      }
      return {
        job: persisted,
        events: buildReviewResolutionEvents({
          job: persisted,
          timestamp: persisted.updatedAt,
          resolution: persisted.status === 'completed' ? 'completed' : 'requires_action'
        })
      };
    }),
    initializeQueuedJob: (job: AgentJob) => persistJob(job).then(async persisted => {
      await taskView.upsertForJob(persisted);
      return persisted;
    }),
    stagePendingAsset: (assetItem: AssetItem) => asset.stagePendingAsset(assetItem),
    stageRunningJob: async ({
      runningJob,
      assetPatch,
      assetViewPatch
    }: {
      runningJob: AgentJob;
      assetPatch: Partial<AssetItem>;
      assetViewPatch?: Partial<AssetItem>;
    }) => {
      await asset.patchTaskAsset({
        persistedPatch: assetPatch,
        visiblePatch: assetViewPatch
      });
      return persistJob(runningJob).then(async persisted => {
        await taskView.upsertForJob(persisted);
        return {
          job: persisted,
          events: buildStepStartedEvents({
            job: persisted,
            timestamp: persisted.updatedAt,
            stepId: persisted.currentStepId
          })
        };
      });
    },
    upsertTaskView: (job: AgentJob) => taskView.upsertForJob(job),
    markTaskVisibleComplete: (job: AgentJob) => taskView.markVisibleComplete(job),
    dismissTaskView: (taskId: string) => taskView.dismissById(taskId),
    clearDismissableTaskViews: () => taskView.clearDismissable(),
    publishAsset: (assetItem: AssetItem) => asset.publishGeneratedAsset(assetItem),
    completeVisibleImage: async ({
      asset: assetItem,
      completedJob
    }: {
      asset: AssetItem;
      completedJob: AgentJob;
      }) => {
      await asset.publishGeneratedAsset(assetItem);
      const persisted = await persistJob(completedJob);
      return {
        job: persisted,
        events: [
          ...buildAssetProducedEvents({
            job: persisted,
            timestamp: persisted.updatedAt,
            artifactId: assetItem.id
          }),
          ...buildReviewResolutionEvents({
            job: persisted,
            timestamp: persisted.updatedAt,
            resolution: 'completed'
          }).filter(event => event.type === 'JobCompleted')
        ]
      };
    },
    publishAssetAndPersistJob: async ({
      asset: assetItem,
      job
    }: {
      asset: AssetItem;
      job: AgentJob;
    }) => {
      await asset.publishGeneratedAsset(assetItem);
      const persisted = await persistJob(job);
      return {
        job: persisted,
        events: [
          ...buildAssetProducedEvents({
            job: persisted,
            timestamp: persisted.updatedAt,
            artifactId: assetItem.id
          }),
          ...buildReviewStartedEvents({
            job: persisted,
            timestamp: persisted.updatedAt
          })
        ]
      };
    },
    patchAsset: (patches: { persistedPatch: Partial<AssetItem>; visiblePatch?: Partial<AssetItem> }) => asset.patchTaskAsset(patches),
    updateOperation: async ({
      operationJob,
      assetPatch
    }: {
      operationJob: AgentJob;
      assetPatch: Partial<AssetItem>;
    }) => {
      await asset.patchTaskAsset({
        persistedPatch: assetPatch
      });
      const persisted = await persistJob(operationJob);
      return {
        job: persisted,
        events: buildStepStartedEvents({
          job: persisted,
          timestamp: persisted.updatedAt,
          stepId: persisted.currentStepId
        })
      };
    },
    completeVideo: async ({
      assetUpdates,
      completedJob
    }: {
      assetUpdates: Partial<AssetItem>;
      completedJob: AgentJob;
    }) => {
      await asset.patchTaskAsset({
        persistedPatch: assetUpdates,
        visiblePatch: assetUpdates
      });
      const persisted = await persistJob(completedJob);
      return {
        job: persisted,
        events: [
          ...buildAssetProducedEvents({
            job: persisted,
            timestamp: persisted.updatedAt,
            artifactId: assetRuntime.options.taskId
          }),
          ...buildReviewResolutionEvents({
            job: persisted,
            timestamp: persisted.updatedAt,
            resolution: 'completed'
          }).filter(event => event.type === 'JobCompleted')
        ]
      };
    },
    deleteTaskAsset: async () => {
      if (!assetRuntime.deps.deleteAssetPermanently) {
        throw new Error('deleteAssetPermanently dependency is required to delete task assets');
      }
      await assetRuntime.deps.deleteAssetPermanently(assetRuntime.options.taskId);
      if (assetRuntime.deps.activeProjectIdRef.current === assetRuntime.options.currentProjectId) {
        assetRuntime.deps.setAssets(assets => assets.filter(assetItem => assetItem.id !== assetRuntime.options.taskId));
      }
    },
    cancel: async (cancelledJob: AgentJob, taskId = taskRuntime.options.viewId) => {
      const persisted = await persistJob(cancelledJob);
      if (taskRuntime.deps.taskViewsRef.current.some(taskViewItem => taskViewItem.id === taskId)) {
        await taskView.dismissById(taskId);
      } else {
        await taskRuntime.deps.deleteTaskView(taskId);
      }
      await assetRuntime.deps.deleteAssetPermanently?.(assetRuntime.options.taskId);
      if (assetRuntime.deps.activeProjectIdRef.current === assetRuntime.options.currentProjectId) {
        assetRuntime.deps.setAssets(assets => assets.filter(assetItem => assetItem.id !== assetRuntime.options.taskId));
      }
      return {
        job: persisted,
        events: buildCancelJobEvents({
          job: persisted,
          timestamp: persisted.updatedAt,
          reason: 'user'
        })
      };
    },
    recoverVisibleAsset: async ({
      recoveredJob,
      visibleJob,
      shouldMarkVisibleComplete
    }: {
      recoveredJob: AgentJob;
      visibleJob: AgentJob;
      shouldMarkVisibleComplete: boolean;
    }) => {
      const persisted = await persistJob(recoveredJob);
      if (shouldMarkVisibleComplete) {
        await taskView.markVisibleComplete(visibleJob);
      }
      return {
        job: persisted,
        events: buildCompletedJobEvents({
          job: persisted,
          timestamp: persisted.updatedAt
        })
      };
    },
    fail: async (failedJob: AgentJob) => {
      const persisted = await (async () => {
        const job = await persistJob(failedJob);
        await taskView.upsertForJob(job);
        return job;
      })();
      await assetRuntime.deps.deleteAssetPermanently?.(assetRuntime.options.taskId);
      if (assetRuntime.deps.activeProjectIdRef.current === assetRuntime.options.currentProjectId) {
        assetRuntime.deps.setAssets(assets => assets.filter(assetItem => assetItem.id !== assetRuntime.options.taskId));
      }
      return {
        job: persisted,
        events: buildFailedJobEvents({
          job: persisted,
          timestamp: persisted.updatedAt,
          error: persisted.lastError
        })
      };
    }
  };
};
