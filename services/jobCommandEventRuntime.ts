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

export const buildReviewStartedEvents = ({
  job,
  timestamp
}: {
  job: AgentJob;
  timestamp: number;
}): RuntimeProjectionEvent[] => [
  createEvent('ReviewStarted', job.id, timestamp, {
    status: job.status
  })
];

export const buildReviewResolutionEvents = ({
  job,
  timestamp,
  resolution
}: {
  job: AgentJob;
  timestamp: number;
  resolution: 'requires_action' | 'completed';
}): RuntimeProjectionEvent[] => {
  const events: RuntimeProjectionEvent[] = [
    createEvent('ReviewCompleted', job.id, timestamp, {
      resolution
    })
  ];

  if (resolution === 'requires_action') {
    events.push(createEvent('RequiresActionRaised', job.id, timestamp, {
      requiresActionType: job.requiresAction?.type
    }));
  } else {
    events.push(createEvent('JobCompleted', job.id, timestamp));
  }

  return events;
};

export const buildStepStartedEvents = ({
  job,
  timestamp,
  stepId
}: {
  job: AgentJob;
  timestamp: number;
  stepId?: string;
}): RuntimeProjectionEvent[] => [
  createEvent('StepStarted', job.id, timestamp, undefined)
].map(event => ({
  ...event,
  stepId
}));

export const buildAssetProducedEvents = ({
  job,
  timestamp,
  artifactId
}: {
  job: AgentJob;
  timestamp: number;
  artifactId?: string;
}): RuntimeProjectionEvent[] => [
  createEvent('AssetProduced', job.id, timestamp, undefined)
].map(event => ({
  ...event,
  artifactId
}));

export const buildCompletedJobEvents = ({
  job,
  timestamp
}: {
  job: AgentJob;
  timestamp: number;
}): RuntimeProjectionEvent[] => [
  createEvent('JobCompleted', job.id, timestamp)
];

export const buildFailedJobEvents = ({
  job,
  timestamp,
  error
}: {
  job: AgentJob;
  timestamp: number;
  error?: string;
}): RuntimeProjectionEvent[] => [
  createEvent('JobFailed', job.id, timestamp, {
    error
  })
];
