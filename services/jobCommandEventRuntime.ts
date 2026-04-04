import type { AgentJob, RuntimeProjectionEvent } from '../types';

const createEvent = (
  type: RuntimeProjectionEvent['type'],
  jobId: string,
  timestamp: number,
  payload?: Record<string, unknown>
): RuntimeProjectionEvent => ({
  type,
  jobId,
  timestamp,
  payload
});

export const buildResumeJobEvents = ({
  job,
  timestamp,
  actionType
}: {
  job: AgentJob;
  timestamp: number;
  actionType?: string;
}): RuntimeProjectionEvent[] => [
  createEvent('JobQueued', job.id, timestamp, {
    actionType
  })
];

export const buildQueuedJobEvents = ({
  job,
  timestamp,
  source
}: {
  job: AgentJob;
  timestamp: number;
  source?: string;
}): RuntimeProjectionEvent[] => [
  createEvent('JobQueued', job.id, timestamp, {
    source
  })
];

export const buildCancelJobEvents = ({
  job,
  timestamp,
  reason
}: {
  job: AgentJob;
  timestamp: number;
  reason?: string;
}): RuntimeProjectionEvent[] => [
  createEvent('JobCancelled', job.id, timestamp, {
    reason
  })
];

export const buildResolveRequiresActionEvents = ({
  job,
  timestamp,
  resolutionType
}: {
  job: AgentJob;
  timestamp: number;
  resolutionType: string;
}): RuntimeProjectionEvent[] => {
  const events: RuntimeProjectionEvent[] = [
    createEvent('RequiresActionResolved', job.id, timestamp, {
      resolutionType
    })
  ];

  if (job.status === 'completed') {
    events.push(createEvent('JobCompleted', job.id, timestamp));
  }

  return events;
};
