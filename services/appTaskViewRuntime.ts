import type { AssetItem, TaskViewIntent } from '../types';

export const createAppTaskViewController = ({
  taskViewDismissal,
  taskControllers,
  deleteAssetPermanently,
  activeProjectIdRef,
  getActiveProjectId,
  setAssets
}: {
  taskViewDismissal: {
    dismissById: (taskId: string) => Promise<void>;
    clearDismissable: () => Promise<void>;
  };
  taskControllers: { current: Record<string, AbortController | undefined> };
  deleteAssetPermanently: (taskId: string) => Promise<void>;
  activeProjectIdRef: { current: string | null };
  getActiveProjectId: () => string | null;
  setAssets: (updater: (assets: AssetItem[]) => AssetItem[]) => void;
}) => {
  const dismissTaskView = (taskId: string) => {
    taskViewDismissal.dismissById(taskId).catch(console.error);
  };

  const cancelTask = (taskId: string) => {
    taskViewDismissal.dismissById(taskId).catch(console.error);
    if (taskControllers.current[taskId]) {
      taskControllers.current[taskId]?.abort();
      deleteAssetPermanently(taskId).catch(console.error);
      if (activeProjectIdRef.current === getActiveProjectId()) {
        setAssets(prev => prev.filter(asset => asset.id !== taskId));
      }
    }
  };

  const handleTaskViewIntent = (intent: TaskViewIntent) => {
    if (intent.type === 'cancel_job') {
      cancelTask(intent.taskId);
      return;
    }

    dismissTaskView(intent.taskId);
  };

  const clearCompletedTasks = () => {
    taskViewDismissal.clearDismissable().catch(console.error);
  };

  return {
    cancelTask,
    dismissTaskView,
    handleTaskViewIntent,
    clearCompletedTasks
  };
};
