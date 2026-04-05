import type {
  AgentJob,
  BackgroundTaskView,
  TaskStatus,
  TaskViewIntent
} from '../types';

// BackgroundTaskView is a read model derived from AgentJob.
// It exists for UX and persistence convenience, not as an execution source of truth.

const ACTIVE_TASK_VIEW_STATUSES: TaskStatus[] = ['QUEUED', 'GENERATING', 'REVIEWING'];
const DISMISSABLE_TASK_VIEW_STATUSES: TaskStatus[] = ['COMPLETED', 'FAILED', 'ACTION_REQUIRED'];

export const getBackgroundTaskViewStatus = (jobStatus: AgentJob['status']): TaskStatus => {
  switch (jobStatus) {
    case 'queued':
    case 'planning':
      return 'QUEUED';
    case 'executing':
    case 'revising':
      return 'GENERATING';
    case 'reviewing':
      return 'REVIEWING';
    case 'requires_action':
      return 'ACTION_REQUIRED';
    case 'completed':
      return 'COMPLETED';
    case 'failed':
    case 'cancelled':
    case 'interrupted':
      return 'FAILED';
    default:
      return 'FAILED';
  }
};

const getTaskViewType = (jobType: AgentJob['type']): BackgroundTaskView['type'] =>
  jobType === 'VIDEO_GENERATION' ? 'VIDEO' : 'IMAGE';

const getTaskPrompt = (job: AgentJob, fallbackPrompt = ''): string => {
  const generationStep = [...job.steps]
    .reverse()
    .find(step => step.kind === 'generation' && typeof step.input?.prompt === 'string');

  return generationStep?.input?.prompt || fallbackPrompt;
};

const getExecutionStartTime = (job: AgentJob): number | undefined => {
  const runningStep = job.steps.find(step => step.status === 'running' && typeof step.startTime === 'number');
  if (runningStep?.startTime) {
    return runningStep.startTime;
  }

  const firstStartedStep = job.steps.find(step => typeof step.startTime === 'number');
  return firstStartedStep?.startTime;
};

export const deriveBackgroundTaskView = (
  job: AgentJob,
  options: {
    projectName: string;
    fallbackPrompt?: string;
    viewId?: string;
  }
): BackgroundTaskView => ({
  id: options.viewId || job.id,
  jobId: job.id,
  projectId: job.projectId,
  projectName: options.projectName,
  type: getTaskViewType(job.type),
  status: getBackgroundTaskViewStatus(job.status),
  startTime: job.createdAt,
  executionStartTime: getExecutionStartTime(job),
  prompt: getTaskPrompt(job, options.fallbackPrompt),
  error: job.lastError
});

export const deriveBackgroundTaskViews = ({
  jobs,
  persistedTaskViews,
  projectNamesById
}: {
  jobs: AgentJob[];
  persistedTaskViews: BackgroundTaskView[];
  projectNamesById: Record<string, string>;
}): BackgroundTaskView[] => {
  const persistedByJobId = new Map(
    persistedTaskViews
      .filter(taskView => typeof taskView.jobId === 'string' && taskView.jobId.length > 0)
      .map(taskView => [taskView.jobId as string, taskView])
  );

  const derivedViews = jobs.map(job => {
    const persistedTaskView = persistedByJobId.get(job.id);
    return deriveBackgroundTaskView(job, {
      projectName: projectNamesById[job.projectId] || persistedTaskView?.projectName || 'Project',
      fallbackPrompt: persistedTaskView?.prompt,
      viewId: persistedTaskView?.id
    });
  });

  const jobIds = new Set(jobs.map(job => job.id));
  const orphanedViews = persistedTaskViews.filter(taskView => !taskView.jobId || !jobIds.has(taskView.jobId));

  return [...derivedViews, ...orphanedViews].sort((a, b) => b.startTime - a.startTime);
};

export const syncTaskViewsForJob = (
  taskViews: BackgroundTaskView[],
  job: AgentJob,
  options: {
    projectName: string;
  }
): BackgroundTaskView[] =>
  taskViews.map(taskView => (
    taskView.jobId === job.id
      ? deriveBackgroundTaskView(job, {
        projectName: options.projectName,
        fallbackPrompt: taskView.prompt,
        viewId: taskView.id
      })
      : taskView
  ));

export const planTaskViewSyncForJob = (
  taskViews: BackgroundTaskView[],
  job: AgentJob,
  options: {
    projectName: string;
  }
): {
  nextTaskViews: BackgroundTaskView[];
  persistencePlan: {
    taskViewsToSave: BackgroundTaskView[];
    taskViewIdsToDelete: string[];
  };
} => {
  const nextTaskViews = syncTaskViewsForJob(taskViews, job, options);
  return {
    nextTaskViews,
    persistencePlan: buildTaskViewPersistencePlan(taskViews, nextTaskViews)
  };
};

export const upsertTaskViewForJob = (
  taskViews: BackgroundTaskView[],
  job: AgentJob,
  options: {
    projectName: string;
    fallbackPrompt?: string;
    viewId?: string;
  }
): BackgroundTaskView[] => {
  const nextTaskView = deriveBackgroundTaskView(job, options);
  const existingIndex = taskViews.findIndex(taskView =>
    taskView.id === nextTaskView.id || (taskView.jobId && taskView.jobId === job.id)
  );

  if (existingIndex === -1) {
    return [nextTaskView, ...taskViews].sort((a, b) => b.startTime - a.startTime);
  }

  const nextTaskViews = [...taskViews];
  nextTaskViews[existingIndex] = nextTaskView;
  return nextTaskViews;
};

export const planTaskViewUpsertForJob = (
  taskViews: BackgroundTaskView[],
  job: AgentJob,
  options: {
    projectName: string;
    fallbackPrompt?: string;
    viewId?: string;
  }
): {
  nextTaskViews: BackgroundTaskView[];
  persistencePlan: {
    taskViewsToSave: BackgroundTaskView[];
    taskViewIdsToDelete: string[];
  };
} => {
  const nextTaskViews = upsertTaskViewForJob(taskViews, job, options);
  return {
    nextTaskViews,
    persistencePlan: buildTaskViewPersistencePlan(taskViews, nextTaskViews)
  };
};

export const createTaskViewIntent = (taskView: BackgroundTaskView): TaskViewIntent => {
  if (ACTIVE_TASK_VIEW_STATUSES.includes(taskView.status) && taskView.jobId) {
    return {
      type: 'cancel_job',
      taskId: taskView.id,
      jobId: taskView.jobId
    };
  }

  return {
    type: 'dismiss_task_view',
    taskId: taskView.id,
    jobId: taskView.jobId
  };
};

export const isActiveTaskView = (taskView: BackgroundTaskView): boolean =>
  ACTIVE_TASK_VIEW_STATUSES.includes(taskView.status);

export const isDismissableTaskView = (taskView: BackgroundTaskView): boolean =>
  DISMISSABLE_TASK_VIEW_STATUSES.includes(taskView.status);

export const clearDismissableTaskViews = (taskViews: BackgroundTaskView[]): {
  remainingTaskViews: BackgroundTaskView[];
  dismissedTaskIds: string[];
} => {
  const dismissedTaskIds = taskViews
    .filter(isDismissableTaskView)
    .map(taskView => taskView.id);

  return {
    remainingTaskViews: taskViews.filter(taskView => !isDismissableTaskView(taskView)),
    dismissedTaskIds
  };
};

export const dismissTaskViewById = (taskViews: BackgroundTaskView[], taskId: string): {
  remainingTaskViews: BackgroundTaskView[];
  dismissedTaskIds: string[];
} => dismissTaskViewsByIds(taskViews, [taskId]);

export const dismissTaskViewsByIds = (taskViews: BackgroundTaskView[], taskIds: string[]): {
  remainingTaskViews: BackgroundTaskView[];
  dismissedTaskIds: string[];
} => {
  const dismissedIdSet = new Set(taskIds);
  const dismissedTaskIds = taskViews
    .filter(taskView => dismissedIdSet.has(taskView.id))
    .map(taskView => taskView.id);

  return {
    remainingTaskViews: taskViews.filter(taskView => !dismissedIdSet.has(taskView.id)),
    dismissedTaskIds
  };
};

const isJobBackedTaskView = (taskView: BackgroundTaskView): boolean =>
  typeof taskView.jobId === 'string' && taskView.jobId.length > 0;

const areTaskViewsEquivalent = (left: BackgroundTaskView, right: BackgroundTaskView): boolean => (
  left.id === right.id
  && left.jobId === right.jobId
  && left.projectId === right.projectId
  && left.projectName === right.projectName
  && left.type === right.type
  && left.status === right.status
  && left.startTime === right.startTime
  && left.executionStartTime === right.executionStartTime
  && left.prompt === right.prompt
  && left.error === right.error
);

export const buildTaskViewPersistencePlan = (
  previousTaskViews: BackgroundTaskView[],
  nextTaskViews: BackgroundTaskView[]
): {
  taskViewsToSave: BackgroundTaskView[];
  taskViewIdsToDelete: string[];
} => {
  const previousJobBackedViews = previousTaskViews.filter(isJobBackedTaskView);
  const previousJobBackedById = new Map(previousJobBackedViews.map(taskView => [taskView.id, taskView]));
  const nextJobBackedViews = nextTaskViews.filter(isJobBackedTaskView);
  const nextJobBackedIds = new Set(nextJobBackedViews.map(taskView => taskView.id));

  return {
    taskViewsToSave: nextJobBackedViews.filter(taskView => {
      const previousTaskView = previousJobBackedById.get(taskView.id);
      return !previousTaskView || !areTaskViewsEquivalent(previousTaskView, taskView);
    }),
    taskViewIdsToDelete: previousJobBackedViews
      .filter(taskView => !nextJobBackedIds.has(taskView.id))
      .map(taskView => taskView.id)
  };
};
