import type { BackgroundTaskView } from '../types';
import type { AgentJob } from '../types';
import { clearDismissableTaskViews, deriveBackgroundTaskView, dismissTaskViewById, planTaskViewUpsertForJob } from './taskReadModel';

export type TaskViewPersistencePlan = {
  taskViewsToSave: BackgroundTaskView[];
  taskViewIdsToDelete: string[];
};

type TaskViewProjectionResult = {
  nextTaskViews: BackgroundTaskView[];
  persistencePlan: TaskViewPersistencePlan;
};

type TaskViewDismissalResult = {
  remainingTaskViews: BackgroundTaskView[];
  dismissedTaskIds: string[];
};

type TaskViewProjectionStateDeps = {
  taskViewsRef: { current: BackgroundTaskView[] };
  setTaskViews: (taskViews: BackgroundTaskView[]) => void;
};

type TaskViewPersistenceDeps = {
  saveTaskView: (taskView: BackgroundTaskView) => Promise<void>;
  deleteTaskView: (taskId: string) => Promise<void>;
};

export const persistTaskViewPersistencePlan = async (
  plan: TaskViewPersistencePlan,
  deps: TaskViewPersistenceDeps
): Promise<void> => {
  await Promise.all([
    ...plan.taskViewsToSave.map(taskView => deps.saveTaskView(taskView)),
    ...plan.taskViewIdsToDelete.map(taskId => deps.deleteTaskView(taskId))
  ]);
};

export const applyTaskViewProjectionResult = async (
  result: TaskViewProjectionResult,
  deps: TaskViewProjectionStateDeps & TaskViewPersistenceDeps
): Promise<void> => {
  deps.taskViewsRef.current = result.nextTaskViews;
  deps.setTaskViews(result.nextTaskViews);
  await persistTaskViewPersistencePlan(result.persistencePlan, deps);
};

export const applyTaskViewDismissal = async (
  dismissal: TaskViewDismissalResult,
  deps: TaskViewProjectionStateDeps & Pick<TaskViewPersistenceDeps, 'deleteTaskView'>
): Promise<void> => {
  deps.taskViewsRef.current = dismissal.remainingTaskViews;
  deps.setTaskViews(dismissal.remainingTaskViews);
  await Promise.all(dismissal.dismissedTaskIds.map(taskId => deps.deleteTaskView(taskId)));
};

export const upsertDerivedTaskViewForJob = async (
  jobSnapshot: AgentJob,
  options: {
    projectName: string;
    fallbackPrompt: string;
    viewId: string;
  },
  deps: TaskViewProjectionStateDeps & TaskViewPersistenceDeps
): Promise<BackgroundTaskView> => {
  const projectionResult = planTaskViewUpsertForJob(
    deps.taskViewsRef.current.filter(task => task.jobId !== jobSnapshot.id || task.id === options.viewId),
    jobSnapshot,
    options
  );
  const taskView = deriveBackgroundTaskView(jobSnapshot, options);
  await applyTaskViewProjectionResult(projectionResult, deps);
  return taskView;
};

export const markTaskViewVisibleComplete = async (
  jobSnapshot: AgentJob,
  options: {
    projectName: string;
    fallbackPrompt: string;
    viewId: string;
  },
  deps: TaskViewProjectionStateDeps & TaskViewPersistenceDeps
): Promise<BackgroundTaskView> => upsertDerivedTaskViewForJob({
  ...jobSnapshot,
  status: 'completed',
  currentStepId: undefined,
  lastError: undefined
}, options, deps);

export const createTaskViewProjectionController = ({
  options,
  deps
}: {
  options: {
    projectName: string;
    fallbackPrompt: string;
    viewId: string;
  };
  deps: TaskViewProjectionStateDeps & TaskViewPersistenceDeps;
}) => ({
  upsertForJob: (jobSnapshot: AgentJob) => upsertDerivedTaskViewForJob(jobSnapshot, options, deps),
  markVisibleComplete: (jobSnapshot: AgentJob) => markTaskViewVisibleComplete(jobSnapshot, options, deps),
  dismissById: (taskId: string) => applyTaskViewDismissal(
    dismissTaskViewById(deps.taskViewsRef.current, taskId),
    deps
  ),
  clearDismissable: () => applyTaskViewDismissal(
    clearDismissableTaskViews(deps.taskViewsRef.current),
    deps
  )
});

export const createTaskViewDismissalController = (
  deps: TaskViewProjectionStateDeps & Pick<TaskViewPersistenceDeps, 'deleteTaskView'>
) => ({
  dismissById: (taskId: string) => applyTaskViewDismissal(
    dismissTaskViewById(deps.taskViewsRef.current, taskId),
    deps
  ),
  clearDismissable: () => applyTaskViewDismissal(
    clearDismissableTaskViews(deps.taskViewsRef.current),
    deps
  )
});
