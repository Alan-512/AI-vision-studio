import type { AgentJob } from '../types';

type AgentJobRef = {
  current: AgentJob;
};

type PersistAgentJobDeps = {
  jobRef: AgentJobRef;
  saveAgentJobSnapshot: (job: AgentJob) => Promise<void>;
};

export const persistAgentJobSnapshot = async (
  job: AgentJob,
  deps: PersistAgentJobDeps
): Promise<AgentJob> => {
  deps.jobRef.current = job;
  await deps.saveAgentJobSnapshot(job);
  return job;
};

export const createAgentJobSnapshotPersister = (
  deps: PersistAgentJobDeps,
  options?: {
    onPersist?: (job: AgentJob) => void;
  }
) => async (job: AgentJob): Promise<AgentJob> => {
  const persisted = await persistAgentJobSnapshot(job, deps);
  options?.onPersist?.(persisted);
  return persisted;
};

export const persistAgentJobPatch = async (
  updates: Partial<AgentJob>,
  deps: PersistAgentJobDeps & {
    now?: () => number;
  }
): Promise<AgentJob> => {
  const nextJob: AgentJob = {
    ...deps.jobRef.current,
    ...updates,
    updatedAt: updates.updatedAt ?? (deps.now ? deps.now() : Date.now())
  };

  deps.jobRef.current = nextJob;
  await deps.saveAgentJobSnapshot(nextJob);
  return nextJob;
};
