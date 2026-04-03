import type { AgentJob, AssetItem, BackgroundTaskView } from '../types';
import { createAgentJobSnapshotPersister } from './agentJobPersistence';
import { createAssetProjectionController } from './assetProjectionPersistence';
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
      return persisted;
    }),
    startAutoRevision: async (jobs: AgentJob[]) => Promise.all(jobs.map(job => persistJob(job))),
    resolvePrimaryReview: (job: AgentJob, shouldSyncTaskView: boolean) => persistJob(job).then(async persisted => {
      if (shouldSyncTaskView) {
        await taskView.upsertForJob(persisted);
      }
      return persisted;
    }),
    resolveAutoRevision: (job: AgentJob, shouldSyncTaskView: boolean) => persistJob(job).then(async persisted => {
      if (shouldSyncTaskView) {
        await taskView.upsertForJob(persisted);
      }
      return persisted;
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
        return persisted;
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
      return persistJob(completedJob);
    },
    publishAssetAndPersistJob: async ({
      asset: assetItem,
      job
    }: {
      asset: AssetItem;
      job: AgentJob;
    }) => {
      await asset.publishGeneratedAsset(assetItem);
      return persistJob(job);
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
      return persistJob(operationJob);
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
      return persistJob(completedJob);
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
      await persistJob(cancelledJob);
      if (taskRuntime.deps.taskViewsRef.current.some(taskViewItem => taskViewItem.id === taskId)) {
        await taskView.dismissById(taskId);
      } else {
        await taskRuntime.deps.deleteTaskView(taskId);
      }
      await assetRuntime.deps.deleteAssetPermanently?.(assetRuntime.options.taskId);
      if (assetRuntime.deps.activeProjectIdRef.current === assetRuntime.options.currentProjectId) {
        assetRuntime.deps.setAssets(assets => assets.filter(assetItem => assetItem.id !== assetRuntime.options.taskId));
      }
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
      await persistJob(recoveredJob);
      if (shouldMarkVisibleComplete) {
        await taskView.markVisibleComplete(visibleJob);
      }
    },
    fail: async (failedJob: AgentJob) => {
      await (async () => {
        const persisted = await persistJob(failedJob);
        await taskView.upsertForJob(persisted);
      })();
      await assetRuntime.deps.deleteAssetPermanently?.(assetRuntime.options.taskId);
      if (assetRuntime.deps.activeProjectIdRef.current === assetRuntime.options.currentProjectId) {
        assetRuntime.deps.setAssets(assets => assets.filter(assetItem => assetItem.id !== assetRuntime.options.taskId));
      }
    }
  };
};
