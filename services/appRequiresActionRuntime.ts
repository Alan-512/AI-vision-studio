import type { AgentJob, Project, ToolCallRecord } from '../types';
import type { ResolveRequiresActionCommand } from './agentKernelTypes';
import type { KernelTransitionResult } from './agentKernelTypes';
import { persistAgentJobSnapshot } from './agentJobPersistence';
import { applyTaskViewProjectionResult } from './taskProjectionPersistence';
import { resolveAgentJobKeepCurrent } from './requiresActionRuntime';
import { planTaskViewSyncForJob } from './taskReadModel';

export const createKeepCurrentCommand = ({
  toolCall,
  createId = () => crypto.randomUUID()
}: {
  toolCall: ToolCallRecord;
  createId?: () => string;
}): ResolveRequiresActionCommand | undefined => {
  const jobId = toolCall.result?.jobId || toolCall.jobId;
  if (!jobId) return undefined;

  return {
    type: 'ResolveRequiresAction',
    jobId,
    resolutionType: toolCall.result?.requiresAction?.type || 'review_output',
    payload: {
      stepId: createId(),
      prompt: typeof toolCall.args?.prompt === 'string' ? toolCall.args.prompt : undefined
    }
  };
};

export const resolveKeepCurrentAction = async ({
  toolCall,
  activeProjectId,
  loadAgentJobsByProject,
  dispatchKernelCommand,
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
  dispatchKernelCommand?: (command: ResolveRequiresActionCommand) => Promise<Pick<KernelTransitionResult, 'jobTransition'>>;
  saveAgentJobSnapshot: (job: AgentJob) => Promise<void>;
  tasksRef: { current: any[] };
  setTaskViews: (taskViews: any[]) => void;
  saveTaskView: (taskView: any) => Promise<void>;
  deleteTaskView: (taskId: string) => Promise<void>;
  projects: Project[];
  now?: () => number;
  createId?: () => string;
}): Promise<AgentJob | undefined> => {
  const command = createKeepCurrentCommand({
    toolCall,
    createId
  });
  if (!command) return undefined;

  if (dispatchKernelCommand) {
    return (await dispatchKernelCommand(command)).jobTransition?.job;
  }

  const existingJobs = await loadAgentJobsByProject(activeProjectId);
  const job = existingJobs.find(entry => entry.id === command.jobId);
  if (!job) return undefined;

  const resolvedJob = resolveAgentJobKeepCurrent(job, {
        now: now(),
        stepId: typeof command.payload?.stepId === 'string' ? command.payload.stepId : createId(),
        actionType: command.resolutionType,
        prompt: typeof command.payload?.prompt === 'string' ? command.payload.prompt : undefined
      });
  if (!resolvedJob) return undefined;

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

  return resolvedJob;
};
