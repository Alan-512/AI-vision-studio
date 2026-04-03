import { describe, expect, it, vi } from 'vitest';
import type { AgentJob } from '../types';
import {
  createAgentJobSnapshotPersister,
  persistAgentJobPatch,
  persistAgentJobSnapshot
} from '../services/agentJobPersistence';

const createJob = (): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'queued',
  createdAt: 100,
  updatedAt: 100,
  source: 'chat',
  currentStepId: undefined,
  steps: [],
  artifacts: []
});

describe('agentJobPersistence', () => {
  it('persists a full job snapshot and updates the mutable ref', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const jobRef = { current: createJob() };
    const nextJob: AgentJob = {
      ...jobRef.current,
      status: 'executing',
      currentStepId: 'step-1',
      updatedAt: 200
    };

    const persisted = await persistAgentJobSnapshot(nextJob, {
      jobRef,
      saveAgentJobSnapshot
    });

    expect(persisted).toEqual(nextJob);
    expect(jobRef.current).toEqual(nextJob);
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(nextJob);
  });

  it('persists a patch by merging it into the current job and defaulting updatedAt', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const jobRef = { current: createJob() };

    const persisted = await persistAgentJobPatch({
      status: 'failed',
      lastError: 'network error'
    }, {
      jobRef,
      saveAgentJobSnapshot,
      now: () => 300
    });

    expect(persisted).toEqual({
      ...createJob(),
      status: 'failed',
      lastError: 'network error',
      updatedAt: 300
    });
    expect(jobRef.current).toEqual(persisted);
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(persisted);
  });

  it('supports one-off snapshot persistence with a temporary ref', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const snapshot: AgentJob = {
      ...createJob(),
      status: 'completed',
      updatedAt: 400
    };

    const persisted = await persistAgentJobSnapshot(snapshot, {
      jobRef: { current: createJob() },
      saveAgentJobSnapshot
    });

    expect(persisted).toEqual(snapshot);
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('creates a reusable snapshot persister around the shared mutable ref', async () => {
    const saveAgentJobSnapshot = vi.fn().mockResolvedValue(undefined);
    const jobRef = { current: createJob() };
    const onPersist = vi.fn();
    const persist = createAgentJobSnapshotPersister({
      jobRef,
      saveAgentJobSnapshot
    }, {
      onPersist
    });

    const nextJob: AgentJob = {
      ...jobRef.current,
      status: 'reviewing',
      updatedAt: 500
    };

    const persisted = await persist(nextJob);

    expect(persisted).toEqual(nextJob);
    expect(jobRef.current).toEqual(nextJob);
    expect(saveAgentJobSnapshot).toHaveBeenCalledWith(nextJob);
    expect(onPersist).toHaveBeenCalledWith(nextJob);
  });
});
