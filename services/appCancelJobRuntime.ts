import type { AgentJob, BackgroundTaskView, Project } from '../types';
import { cancelAgentJob } from './agentRuntime';
import { persistAgentJobSnapshot } from './agentJobPersistence';
import { applyTaskViewProjectionResult } from './taskProjectionPersistence';
import { planTaskViewSyncForJob } from './taskReadModel';

export const executeAppCancelJob = async ({
  command,
  activeProjectId,
  loadAgentJobsByProject,
  saveAgentJobSnapshot,
  tasksRef,
  setTaskViews,
  saveTaskView,
  deleteTaskView,
  projects,
  now = () => Date.now()
}: {
  command: {
    type: 'CancelJob';
    jobId: string;
    reason?: string;
  };
  activeProjectId: string;
  loadAgentJobsByProject: (projectId: string) => Promise<AgentJob[]>;
  saveAgentJobSnapshot: (job: AgentJob) => Promise<void>;
  tasksRef: { current: BackgroundTaskView[] };
  setTaskViews: (taskViews: BackgroundTaskView[]) => void;
  saveTaskView: (taskView: BackgroundTaskView) => Promise<void>;
  deleteTaskView: (taskId: string) => Promise<void>;
  projects: Project[];
  now?: () => number;
}) => {
  const existingJobs = await loadAgentJobsByProject(activeProjectId);
  const job = existingJobs.find(entry => entry.id === command.jobId);
  if (!job) {
    throw new Error(`Job ${command.jobId} not found`);
  }

  const stepId = job.currentStepId || job.steps[job.steps.length - 1]?.id;
  if (!stepId) {
    throw new Error(`Job ${command.jobId} has no step to cancel`);
  }

  const cancelledJob = cancelAgentJob(job, {
    stepId,
    reason: command.reason || 'Cancelled by user',
    now: now()
  });

  await persistAgentJobSnapshot(cancelledJob, {
    jobRef: { current: job },
    saveAgentJobSnapshot
  });

  const relatedTasks = tasksRef.current.filter(task => task.jobId === command.jobId);
  if (relatedTasks.length > 0) {
    const projectName = projects.find(project => project.id === cancelledJob.projectId)?.name || 'Project';
    await applyTaskViewProjectionResult(
      planTaskViewSyncForJob(tasksRef.current, cancelledJob, { projectName }),
      {
        taskViewsRef: tasksRef,
        setTaskViews,
        saveTaskView,
        deleteTaskView
      }
    );
  }

  return {
    job: cancelledJob,
    events: [],
    toolResult: undefined
  };
};
