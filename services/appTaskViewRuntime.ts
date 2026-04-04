import type { AssetItem, TaskViewIntent } from '../types';
import type { CancelJobCommand, KernelTransitionResult } from './agentKernelTypes';

export const createAppTaskViewController = ({
  taskViewDismissal,
  taskControllers,
  deleteAssetPermanently,
  activeProjectIdRef,
  getActiveProjectId,
  setAssets,
  dispatchKernelCommand
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
  dispatchKernelCommand?: (command: CancelJobCommand) => Promise<Pick<KernelTransitionResult, 'jobTransition'>>;
}) => {
  const dismissTaskView = async (taskId: string) => {
    await taskViewDismissal.dismissById(taskId);
  };

  const cancelTask = async (taskId: string, jobId?: string) => {
    if (jobId && dispatchKernelCommand) {
      await dispatchKernelCommand({
        type: 'CancelJob',
        jobId,
        reason: 'Cancelled from task center'
      });
    }
    await taskViewDismissal.dismissById(taskId);
    if (taskControllers.current[taskId]) {
      taskControllers.current[taskId]?.abort();
      deleteAssetPermanently(taskId).catch(console.error);
      if (activeProjectIdRef.current === getActiveProjectId()) {
        setAssets(prev => prev.filter(asset => asset.id !== taskId));
      }
    }
  };

  const handleTaskViewIntent = async (intent: TaskViewIntent) => {
    if (intent.type === 'cancel_job') {
      await cancelTask(intent.taskId, intent.jobId);
      return;
    }

    await dismissTaskView(intent.taskId);
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
