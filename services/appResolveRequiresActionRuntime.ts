import type { AgentJob, BackgroundTaskView, Project } from '../types';
import { persistAgentJobSnapshot } from './agentJobPersistence';
import { resolveAgentJobKeepCurrent } from './requiresActionRuntime';
import { applyTaskViewProjectionResult } from './taskProjectionPersistence';
import { planTaskViewSyncForJob } from './taskReadModel';

export const executeAppResolveRequiresAction = async ({
  command,
  activeProjectId,
  loadAgentJobsByProject,
  saveAgentJobSnapshot,
  tasksRef,
  setTaskViews,
  saveTaskView,
  deleteTaskView,
  projects,
  now = () => Date.now(),
  createId = () => crypto.randomUUID()
}: {
  command: {
    type: 'ResolveRequiresAction';
    jobId: string;
    resolutionType: string;
    payload?: Record<string, unknown>;
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
  createId?: () => string;
}) => {
  const existingJobs = await loadAgentJobsByProject(activeProjectId);
  const job = existingJobs.find(entry => entry.id === command.jobId);
  if (!job) {
    throw new Error(`Job ${command.jobId} not found`);
  }

  const resolvedJob = resolveAgentJobKeepCurrent(job, {
    now: now(),
    stepId: typeof command.payload?.stepId === 'string' ? command.payload.stepId : createId(),
    actionType: command.resolutionType,
    prompt: typeof command.payload?.prompt === 'string' ? command.payload.prompt : undefined
  });

  await persistAgentJobSnapshot(resolvedJob, {
    jobRef: { current: job },
    saveAgentJobSnapshot
  });

  const relatedTasks = tasksRef.current.filter(task => task.jobId === command.jobId);
  if (relatedTasks.length > 0) {
    const projectName = projects.find(project => project.id === resolvedJob.projectId)?.name || 'Project';
    await applyTaskViewProjectionResult(
      planTaskViewSyncForJob(tasksRef.current, resolvedJob, { projectName }),
      {
        taskViewsRef: tasksRef,
        setTaskViews,
        saveTaskView,
        deleteTaskView
      }
    );
  }

  return {
    job: resolvedJob,
    events: [],
    toolResult: undefined
  };
};
