import type { AgentJob, BackgroundTask, Project } from '../types';
import { persistAgentJobSnapshot } from './agentJobPersistence';
import { buildTaskViewPersistencePlan, deriveBackgroundTaskViews } from './taskReadModel';
import { persistTaskViewPersistencePlan } from './taskProjectionPersistence';

const INTERRUPTIBLE_AGENT_JOB_STATUSES = ['queued', 'planning', 'executing', 'reviewing', 'revising'] as const;

export const recoverPersistedTaskViews = async ({
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
  const interruptedAt = now();
  const recoveredAgentJobs = await Promise.all(persistedAgentJobs.map(async job => {
    if (!INTERRUPTIBLE_AGENT_JOB_STATUSES.includes(job.status as (typeof INTERRUPTIBLE_AGENT_JOB_STATUSES)[number])) {
      return job;
    }

    const interruptedJob: AgentJob = {
      ...job,
      status: 'interrupted',
      currentStepId: undefined,
      lastError: 'Job interrupted by page refresh',
      updatedAt: interruptedAt,
      steps: job.steps.map(step => {
        if (step.status !== 'running') {
          return step;
        }

        return {
          ...step,
          status: 'failed',
          error: 'Job interrupted by page refresh',
          endTime: interruptedAt
        };
      })
    };

    await persistAgentJobSnapshot(interruptedJob, {
      jobRef: { current: job },
      saveAgentJobSnapshot
    });
    return interruptedJob;
  }));

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
    recoveredAgentJobs,
    recoveredTaskViews
  };
};
