import type { AgentJob, Project, ToolCallRecord } from '../types';
import { persistAgentJobSnapshot } from './agentJobPersistence';
import { applyTaskViewProjectionResult } from './taskProjectionPersistence';
import { resolveAgentJobKeepCurrent } from './requiresActionRuntime';
import { planTaskViewSyncForJob } from './taskReadModel';

export const resolveKeepCurrentAction = async ({
  toolCall,
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
  toolCall: ToolCallRecord;
  activeProjectId: string;
  loadAgentJobsByProject: (projectId: string) => Promise<AgentJob[]>;
  saveAgentJobSnapshot: (job: AgentJob) => Promise<void>;
  tasksRef: { current: any[] };
  setTaskViews: (taskViews: any[]) => void;
  saveTaskView: (taskView: any) => Promise<void>;
  deleteTaskView: (taskId: string) => Promise<void>;
  projects: Project[];
  now?: () => number;
  createId?: () => string;
}): Promise<AgentJob | undefined> => {
  const jobId = toolCall.result?.jobId || toolCall.jobId;
  if (!jobId) return undefined;

  const existingJobs = await loadAgentJobsByProject(activeProjectId);
  const job = existingJobs.find(entry => entry.id === jobId);
  if (!job) return undefined;

  const resolvedAt = now();
  const resolvedJob = resolveAgentJobKeepCurrent(job, {
    now: resolvedAt,
    stepId: createId(),
    actionType: toolCall.result?.requiresAction?.type,
    prompt: typeof toolCall.args?.prompt === 'string' ? toolCall.args.prompt : undefined
  });

  await persistAgentJobSnapshot(resolvedJob, {
    jobRef: { current: job },
    saveAgentJobSnapshot
  });

  const relatedTasks = tasksRef.current.filter(task => task.jobId === jobId);
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

  return resolvedJob;
};
