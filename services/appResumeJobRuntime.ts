import type { AgentJob, BackgroundTaskView, Project } from '../types';
import { persistAgentJobSnapshot } from './agentJobPersistence';
import { buildResumeJobEvents } from './jobCommandEventRuntime';
import { applyTaskViewProjectionResult } from './taskProjectionPersistence';
import { planTaskViewSyncForJob } from './taskReadModel';

export const executeAppResumeJob = async ({
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
    type: 'ResumeJob';
    jobId: string;
    actionType?: string;
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

  const resumedJob: AgentJob = {
    ...job,
    status: 'queued',
    updatedAt: now(),
    lastError: undefined,
    requiresAction: undefined
  };

  await persistAgentJobSnapshot(resumedJob, {
    jobRef: { current: job },
    saveAgentJobSnapshot
  });

  const relatedTasks = tasksRef.current.filter(task => task.jobId === command.jobId);
  if (relatedTasks.length > 0) {
    const projectName = projects.find(project => project.id === resumedJob.projectId)?.name || 'Project';
    await applyTaskViewProjectionResult(
      planTaskViewSyncForJob(tasksRef.current, resumedJob, { projectName }),
      {
        taskViewsRef: tasksRef,
        setTaskViews,
        saveTaskView,
        deleteTaskView
      }
    );
  }

  return {
    job: resumedJob,
    events: buildResumeJobEvents({
      job: resumedJob,
      timestamp: resumedJob.updatedAt,
      actionType: command.actionType
    }),
    toolResult: undefined
  };
};
