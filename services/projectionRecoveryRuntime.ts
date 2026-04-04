import type { AgentJob, BackgroundTask, Project } from '../types';
import { persistAgentJobSnapshot } from './agentJobPersistence';
import { buildTaskViewPersistencePlan, deriveBackgroundTaskViews } from './taskReadModel';
import { persistTaskViewPersistencePlan } from './taskProjectionPersistence';

const INTERRUPTIBLE_AGENT_JOB_STATUSES = ['queued', 'planning', 'executing', 'reviewing', 'revising'] as const;

export const repairInterruptedAgentJobs = async ({
  persistedAgentJobs,
  saveAgentJobSnapshot,
  now = () => Date.now()
}: {
  persistedAgentJobs: AgentJob[];
  saveAgentJobSnapshot: (job: AgentJob) => Promise<void>;
  now?: () => number;
}): Promise<AgentJob[]> => {
  const interruptedAt = now();

  return Promise.all(persistedAgentJobs.map(async job => {
    if (!INTERRUPTIBLE_AGENT_JOB_STATUSES.includes(job.status as (typeof INTERRUPTIBLE_AGENT_JOB_STATUSES)[number])) {
      return job;
    }

    const interruptedJob: AgentJob = {
      ...job,
      status: 'interrupted',
      currentStepId: undefined,
      lastError: 'Job interrupted by page refresh',
      updatedAt: interruptedAt,
      steps: job.steps.map(step => (
        step.status === 'running'
          ? {
              ...step,
              status: 'failed',
              error: 'Job interrupted by page refresh',
              endTime: interruptedAt
            }
          : step
      ))
    };

    await persistAgentJobSnapshot(interruptedJob, {
      jobRef: { current: job },
      saveAgentJobSnapshot
    });

    return interruptedJob;
  }));
};

export const rebuildTaskViewProjections = async ({
  persistedTaskViews,
  recoveredAgentJobs,
  projects,
  saveTaskView,
  deleteTaskView
}: {
  persistedTaskViews: BackgroundTask[];
  recoveredAgentJobs: AgentJob[];
  projects: Project[];
  saveTaskView: (task: BackgroundTask) => Promise<void>;
  deleteTaskView: (taskId: string) => Promise<void>;
}) => {
  const projectNamesById = Object.fromEntries(projects.map(project => [project.id, project.name]));
  const recoveredTaskViews = deriveBackgroundTaskViews({
    jobs: recoveredAgentJobs,
    persistedTaskViews,
    projectNamesById
  });
  const persistencePlan = buildTaskViewPersistencePlan(persistedTaskViews, recoveredTaskViews);

  await persistTaskViewPersistencePlan(persistencePlan, {
    saveTaskView,
    deleteTaskView
  });

  return {
    recoveredTaskViews,
    persistencePlan
  };
};

export const recoverWriteModelsAndRebuildProjections = async ({
  persistedTaskViews,
  persistedAgentJobs,
  projects,
  saveAgentJobSnapshot,
  saveTaskView,
  deleteTaskView,
  now = () => Date.now()
}: {
  persistedTaskViews: BackgroundTask[];
  persistedAgentJobs: AgentJob[];
  projects: Project[];
  saveAgentJobSnapshot: (job: AgentJob) => Promise<void>;
  saveTaskView: (task: BackgroundTask) => Promise<void>;
  deleteTaskView: (taskId: string) => Promise<void>;
  now?: () => number;
}) => {
  const recoveredAgentJobs = await repairInterruptedAgentJobs({
    persistedAgentJobs,
    saveAgentJobSnapshot,
    now
  });

  const { recoveredTaskViews } = await rebuildTaskViewProjections({
    persistedTaskViews,
    recoveredAgentJobs,
    projects,
    saveTaskView,
    deleteTaskView
  });

  return {
    recoveredAgentJobs,
    recoveredTaskViews
  };
};
