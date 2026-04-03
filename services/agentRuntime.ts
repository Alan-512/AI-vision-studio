import { AgentAction, AgentJob, AgentToolResult, AppMode, AssetItem, ChatMessage, CriticDecision, CriticIssue, GenerationParams, JobArtifact, ReviewTrace, SearchProgress, SmartAsset, StructuredCriticReview, RevisionPlan } from '../types';

export type SelectedReferenceRecord = {
  asset: SmartAsset;
  sourceRole: 'user' | 'model';
  messageTimestamp?: number;
};

export type RuntimeReviewPayload = {
  decision: CriticDecision;
  summary: string;
  warnings: string[];
  issues?: CriticIssue[];
  quality?: StructuredCriticReview['quality'];
  reviewTrace?: ReviewTrace;
  revisedPrompt?: string;
  revisionReason?: string;
  reviewPlan?: RevisionPlan;
  requiresAction?: {
    type: string;
    message: string;
    payload?: Record<string, unknown>;
  };
};

type ArtifactReferenceCandidate = {
  candidateIds: Set<string>;
  record: SelectedReferenceRecord;
};

export const buildReferenceArtifacts = (references: SelectedReferenceRecord[]): JobArtifact[] =>
  references.map(reference => ({
    id: crypto.randomUUID(),
    type: 'image',
    origin: 'user_upload',
    role: 'reference',
    base64: reference.asset.data,
    mimeType: reference.asset.mimeType,
    createdAt: Date.now(),
    relatedMessageTimestamp: reference.messageTimestamp,
    metadata: {
      sourceImageId: reference.asset.id,
      sourceRole: reference.sourceRole,
      runtimeKey: `reference:${reference.asset.id}`
    }
  }));

export const createGenerationStep = (
  stepId: string,
  mode: AppMode,
  params: GenerationParams,
  toolCall?: AgentAction
) => ({
  id: stepId,
  kind: 'generation' as const,
  name: mode === AppMode.IMAGE ? 'generate_image' : 'generate_video',
  toolName: toolCall?.toolName || (mode === AppMode.IMAGE ? 'generate_image' : 'generate_video'),
  status: 'pending' as const,
  input: {
    prompt: params.prompt,
    model: mode === AppMode.IMAGE ? params.imageModel : params.videoModel,
    aspectRatio: params.aspectRatio,
    resolution: mode === AppMode.IMAGE ? params.imageResolution : params.videoResolution,
    duration: mode === AppMode.VIDEO ? params.videoDuration : undefined,
    useGrounding: params.useGrounding,
    toolArgs: toolCall?.args
  }
});

export const buildGeneratedArtifact = (
  asset: AssetItem,
  stepId: string,
  overrides?: Partial<JobArtifact>
): JobArtifact => ({
  id: asset.id,
  type: asset.type === 'IMAGE' ? 'image' : 'video',
  origin: 'generated',
  role: 'final',
  url: asset.url,
  mimeType: asset.type === 'IMAGE' && asset.url.startsWith('data:') ? asset.url.match(/^data:(.+);base64,/)?.[1] : undefined,
  createdAt: asset.createdAt,
  relatedStepId: stepId,
  metadata: {
    ...asset.metadata,
    runtimeKey: `generated:${asset.id}`
  },
  ...overrides
});

export const createReviewStep = (stepId: string, toolResult: AgentToolResult) => ({
  id: stepId,
  kind: 'review' as const,
  name: 'review_generated_asset',
  status: 'pending' as const,
  input: {
    toolName: toolResult.toolName,
    artifactIds: toolResult.artifactIds || [],
    jobId: toolResult.jobId
  }
});

export const buildReviewArtifact = (
  reviewId: string,
  reviewStepId: string,
  review: RuntimeReviewPayload
): JobArtifact => ({
  id: reviewId,
  type: 'text',
  origin: 'review',
  role: 'review_note',
  createdAt: Date.now(),
  relatedStepId: reviewStepId,
  metadata: {
    decision: review.decision,
    summary: review.summary,
    warnings: review.warnings,
    issues: review.issues,
    quality: review.quality,
    reviewTrace: review.reviewTrace,
    revisedPrompt: review.revisedPrompt,
    revisionReason: review.revisionReason,
    requiresAction: review.requiresAction
  }
});

export const createRevisionStep = (
  stepId: string,
  review: RuntimeReviewPayload,
  previousPrompt: string
) => ({
  id: stepId,
  kind: 'revision' as const,
  name: 'revise_generation_prompt',
  status: 'pending' as const,
  input: {
    previousPrompt,
    revisionReason: review.revisionReason || review.summary,
    revisedPrompt: review.revisedPrompt || previousPrompt
  }
});

const updateJobStep = (
  job: AgentJob,
  stepId: string,
  updater: (step: AgentJob['steps'][number]) => AgentJob['steps'][number]
): AgentJob['steps'] => job.steps.map(step => step.id === stepId ? updater(step) : step);

export const mergeAgentJobStepOutput = (
  job: AgentJob,
  options: {
    stepId: string;
    output: Record<string, unknown>;
    now: number;
  }
): AgentJob => ({
  ...job,
  updatedAt: options.now,
  steps: updateJobStep(job, options.stepId, step => ({
    ...step,
    output: {
      ...(step.output || {}),
      ...options.output
    }
  }))
});

export const succeedAgentJobStep = (
  job: AgentJob,
  options: {
    stepId: string;
    output: Record<string, unknown>;
    now: number;
  }
): AgentJob => ({
  ...job,
  updatedAt: options.now,
  steps: updateJobStep(job, options.stepId, step => ({
    ...step,
    status: 'success',
    endTime: options.now,
    output: {
      ...(step.output || {}),
      ...options.output
    }
  }))
});

export const startAgentJobExecution = (
  job: AgentJob,
  options: {
    stepId: string;
    now: number;
  }
): AgentJob => ({
  ...job,
  status: 'executing',
  currentStepId: options.stepId,
  updatedAt: options.now,
  steps: updateJobStep(job, options.stepId, step => ({
    ...step,
    status: 'running',
    startTime: step.startTime ?? options.now
  }))
});

export const startAgentJobReview = (
  job: AgentJob,
  options: {
    reviewStep: AgentJob['steps'][number];
    generatedArtifact: JobArtifact;
    now: number;
  }
): AgentJob => ({
  ...job,
  status: 'reviewing',
  currentStepId: options.reviewStep.id,
  lastError: undefined,
  updatedAt: options.now,
  steps: [...job.steps, options.reviewStep],
  artifacts: [...job.artifacts, options.generatedArtifact]
});

export const completeAgentJob = (
  job: AgentJob,
  options: {
    now: number;
    steps?: AgentJob['steps'];
    artifacts?: JobArtifact[];
    lastError?: string;
  }
): AgentJob => ({
  ...job,
  status: 'completed',
  currentStepId: undefined,
  lastError: options.lastError,
  requiresAction: undefined,
  updatedAt: options.now,
  steps: options.steps ?? job.steps,
  artifacts: options.artifacts ?? job.artifacts
});

export const requireAgentJobAction = (
  job: AgentJob,
  options: {
    now: number;
    lastError: string;
    requiresAction: NonNullable<AgentJob['requiresAction']>;
    steps?: AgentJob['steps'];
    artifacts?: JobArtifact[];
  }
): AgentJob => ({
  ...job,
  status: 'requires_action',
  currentStepId: undefined,
  lastError: options.lastError,
  requiresAction: options.requiresAction,
  updatedAt: options.now,
  steps: options.steps ?? job.steps,
  artifacts: options.artifacts ?? job.artifacts
});

export const failAgentJob = (
  job: AgentJob,
  options: {
    stepId: string;
    error: string;
    now: number;
  }
): AgentJob => ({
  ...job,
  status: 'failed',
  currentStepId: undefined,
  lastError: options.error,
  updatedAt: options.now,
  steps: updateJobStep(job, options.stepId, step => ({
    ...step,
    status: 'failed',
    endTime: options.now,
    error: options.error
  }))
});

export const cancelAgentJob = (
  job: AgentJob,
  options: {
    stepId: string;
    reason: string;
    now: number;
  }
): AgentJob => ({
  ...job,
  status: 'cancelled',
  currentStepId: undefined,
  lastError: options.reason,
  updatedAt: options.now,
  steps: updateJobStep(job, options.stepId, step => ({
    ...step,
    status: 'cancelled',
    endTime: options.now,
    error: options.reason
  }))
});

export const extractSearchContextFromProgress = (searchProgress?: SearchProgress | null): AgentJob['searchContext'] | undefined => {
  if (!searchProgress || searchProgress.status !== 'complete') return undefined;

  const facts = (searchProgress.results || [])
    .filter(item => item.label || item.value)
    .map(item => ({
      item: item.label ? `${item.label}: ${item.value}` : item.value,
      source: undefined
    }));

  return {
    queries: searchProgress.queries || [],
    facts,
    sources: searchProgress.sources || []
  };
};

export const buildSearchArtifacts = (searchContext?: AgentJob['searchContext']): JobArtifact[] => {
  if (!searchContext) return [];

  const artifacts: JobArtifact[] = [];
  if ((searchContext.facts && searchContext.facts.length > 0) || (searchContext.sources && searchContext.sources.length > 0)) {
    artifacts.push({
      id: crypto.randomUUID(),
      type: 'json',
      origin: 'search',
      role: 'retrieved_context',
      createdAt: Date.now(),
      metadata: {
        runtimeKey: `search:${(searchContext.queries || []).join('|')}`,
        queries: searchContext.queries || [],
        facts: searchContext.facts || [],
        sources: searchContext.sources || []
      }
    });
  }
  return artifacts;
};

export const mergeRuntimeArtifacts = (existing: JobArtifact[], additions: JobArtifact[]): JobArtifact[] => {
  const seen = new Set(
    existing
      .map(artifact => artifact.metadata?.runtimeKey)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  );

  const uniqueAdditions = additions.filter(artifact => {
    const runtimeKey = artifact.metadata?.runtimeKey;
    if (typeof runtimeKey !== 'string' || runtimeKey.length === 0) return true;
    if (seen.has(runtimeKey)) return false;
    seen.add(runtimeKey);
    return true;
  });

  return [...existing, ...uniqueAdditions];
};

export const artifactToSmartAsset = (artifact: JobArtifact): SmartAsset | null => {
  if (artifact.base64 && artifact.mimeType) {
    return {
      id: artifact.metadata?.sourceImageId || artifact.id,
      mimeType: artifact.mimeType,
      data: artifact.base64
    };
  }
  if (artifact.url && artifact.url.startsWith('data:')) {
    const match = artifact.url.match(/^data:(.+);base64,(.+)$/);
    if (!match) return null;
    return {
      id: artifact.metadata?.sourceImageId || artifact.id,
      mimeType: match[1],
      data: match[2]
    };
  }
  return null;
};

export const extractImagesFromMessage = (message: ChatMessage): string[] => {
  if (message.images && message.images.length > 0) return message.images;
  if (message.image) return [message.image];
  return [];
};

export const dataUrlToSmartAsset = (imgData: string, id: string): SmartAsset | null => {
  const match = imgData.match(/^data:(.+);base64,(.+)$/);
  return match ? { id, mimeType: match[1], data: match[2] } : null;
};

const buildArtifactReferenceCandidate = (artifact: JobArtifact): ArtifactReferenceCandidate | undefined => {
  const asset = artifactToSmartAsset(artifact);
  if (!asset) return undefined;

  const candidateIds = new Set<string>();
  if (typeof artifact.id === 'string') candidateIds.add(artifact.id);
  if (typeof artifact.metadata?.runtimeKey === 'string') candidateIds.add(artifact.metadata.runtimeKey);
  if (typeof artifact.metadata?.sourceImageId === 'string') candidateIds.add(artifact.metadata.sourceImageId);

  const sourceRole: SelectedReferenceRecord['sourceRole'] =
    artifact.origin === 'generated'
      ? 'model'
      : artifact.metadata?.sourceRole === 'model'
        ? 'model'
        : 'user';

  return {
    candidateIds,
    record: {
      asset,
      sourceRole,
      messageTimestamp: artifact.relatedMessageTimestamp
    }
  };
};

const isArtifactReferenceCandidate = (
  candidate: ArtifactReferenceCandidate | undefined
): candidate is ArtifactReferenceCandidate => candidate !== undefined;

export const buildArtifactReferenceCandidates = (jobs: AgentJob[]): ArtifactReferenceCandidate[] =>
  [...jobs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap(job => job.artifacts)
    .filter(artifact => artifact.role === 'reference' || artifact.origin === 'generated')
    .map(buildArtifactReferenceCandidate)
    .filter(isArtifactReferenceCandidate);

export const selectReferenceRecords = ({
  jobs,
  chatHistory,
  requestedIds,
  playbookReferenceMode,
  hasUserUploadedImages
}: {
  jobs: AgentJob[];
  chatHistory: ChatMessage[];
  requestedIds: string[];
  playbookReferenceMode?: string;
  hasUserUploadedImages: boolean;
}): SelectedReferenceRecord[] => {
  const selectedReferences: SelectedReferenceRecord[] = [];
  const pushSelectedReference = (record: SelectedReferenceRecord) => {
    const exists = selectedReferences.some(existing =>
      existing.asset.id === record.asset.id ||
      existing.asset.data.slice(0, 80) === record.asset.data.slice(0, 80)
    );
    if (!exists) {
      selectedReferences.push(record);
    }
  };

  const artifactReferenceCandidates = buildArtifactReferenceCandidates(jobs);
  const messagesWithImages = chatHistory.filter(m => m.image || (m.images && m.images.length > 0));

  if (requestedIds.length > 0) {
    artifactReferenceCandidates.forEach(candidate => {
      if (requestedIds.some(id => candidate.candidateIds.has(id))) {
        pushSelectedReference(candidate.record);
      }
    });

    const allAvailableImages = messagesWithImages.flatMap(m => {
      const prefix = m.role === 'user' ? 'user' : 'generated';
      return extractImagesFromMessage(m).map((img, idx) => ({
        id: `${prefix}-${m.timestamp}-${idx}`,
        img,
        sourceRole: m.role === 'user' ? 'user' as const : 'model' as const,
        messageTimestamp: m.timestamp
      }));
    });

    allAvailableImages.forEach(({ id, img, sourceRole, messageTimestamp }) => {
      if (requestedIds.includes(id)) {
        const asset = dataUrlToSmartAsset(img, id);
        if (asset) pushSelectedReference({ asset, sourceRole, messageTimestamp });
      }
    });

    return selectedReferences;
  }

  if (playbookReferenceMode === 'LAST_GENERATED') {
    const latestGeneratedArtifact = [...jobs]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .flatMap(job => [...job.artifacts].reverse())
      .find(artifact => artifact.origin === 'generated' && (artifact.role === 'final' || artifact.role === 'candidate'));
    const latestGeneratedAsset = latestGeneratedArtifact ? artifactToSmartAsset(latestGeneratedArtifact) : null;
    if (latestGeneratedArtifact && latestGeneratedAsset) {
      pushSelectedReference({
        asset: latestGeneratedAsset,
        sourceRole: 'model',
        messageTimestamp: latestGeneratedArtifact.relatedMessageTimestamp
      });
      return selectedReferences;
    }

    const lastGenerated = [...messagesWithImages].reverse().find(m => m.role === 'model');
    if (lastGenerated) {
      const images = extractImagesFromMessage(lastGenerated);
      const asset = dataUrlToSmartAsset(images[images.length - 1], `generated-${lastGenerated.timestamp}-0`);
      if (asset) pushSelectedReference({ asset, sourceRole: 'model', messageTimestamp: lastGenerated.timestamp });
    }
    return selectedReferences;
  }

  if (hasUserUploadedImages) {
    const lastUserMsg = [...messagesWithImages].reverse().find(m => m.role === 'user' && !m.isSystem);
    if (lastUserMsg) {
      const images = extractImagesFromMessage(lastUserMsg);
      const asset = dataUrlToSmartAsset(images[images.length - 1], `user-${lastUserMsg.timestamp}-0`);
      if (asset) pushSelectedReference({ asset, sourceRole: 'user', messageTimestamp: lastUserMsg.timestamp });
      return selectedReferences;
    }
  }

  const latestReferenceArtifact = [...jobs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap(job => [...job.artifacts].reverse())
    .find(artifact => artifact.role === 'reference');
  const latestReferenceAsset = latestReferenceArtifact ? artifactToSmartAsset(latestReferenceArtifact) : null;
  if (latestReferenceArtifact && latestReferenceAsset) {
    pushSelectedReference({
      asset: latestReferenceAsset,
      sourceRole: 'user',
      messageTimestamp: latestReferenceArtifact.relatedMessageTimestamp
    });
    return selectedReferences;
  }

  const lastUserMsg = [...messagesWithImages].reverse().find(m => m.role === 'user' && !m.isSystem);
  if (lastUserMsg) {
    const images = extractImagesFromMessage(lastUserMsg);
    const asset = dataUrlToSmartAsset(images[images.length - 1], `user-${lastUserMsg.timestamp}-0`);
    if (asset) pushSelectedReference({ asset, sourceRole: 'user', messageTimestamp: lastUserMsg.timestamp });
  }

  return selectedReferences;
};
