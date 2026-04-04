import type { AgentJob, BackgroundTask, Project } from '../types';
import { recoverWriteModelsAndRebuildProjections } from './projectionRecoveryRuntime';

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
}) => recoverWriteModelsAndRebuildProjections({
  persistedTaskViews,
  persistedAgentJobs,
  projects,
  saveAgentJobSnapshot,
  saveTaskView,
  deleteTaskView,
  now
});
