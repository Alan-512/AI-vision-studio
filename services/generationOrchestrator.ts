import {
  AppMode,
  type AgentAction,
  type AgentToolResult,
  type AgentToolResultStatus,
  type AgentJob,
  type AssetItem,
  type ConsistencyProfile,
  type CriticDecision,
  type CriticIssue,
  type EditRegion,
  type GenerationParams,
  type JobArtifact,
  type JobStep,
  type ReviewTrace,
  type RevisionPlan,
  type StructuredCriticReview
} from '../types';
import { buildGeneratedArtifact, buildReferenceArtifacts, buildReviewArtifact, buildSearchArtifacts, cancelAgentJob, completeAgentJob, createGenerationStep, createReviewStep, createRevisionStep, failAgentJob, mergeAgentJobStepOutput, mergeRuntimeArtifacts, requireAgentJobAction, startAgentJobExecution, startAgentJobReview, succeedAgentJobStep, type SelectedReferenceRecord } from './agentRuntime';

export type GenerationReviewPayload = {
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

type LocalizedText = {
  zh: string;
  en: string;
};

type RequiresActionPayloadI18n = {
  title?: LocalizedText;
  message?: LocalizedText;
  warnings?: { zh: string[]; en: string[] };
};

export const buildEditPrompt = (basePrompt: string, regions?: EditRegion[]) => {
  const normalizedBase = basePrompt?.trim() || '';
  const regionLines = (regions || [])
    .filter(region => region.instruction?.trim())
    .map(region => `- Region ${region.id}: ${region.instruction!.trim()}`);

  return `
[EDIT_SPEC]
Image 1 = Base image
Image 2 = Mask (WHITE = edit, BLACK = keep)

Rules:
1) Only edit WHITE areas; keep BLACK areas unchanged.
2) Preserve overall composition, identity, lighting, and style.
3) If instructions conflict with mask, mask wins.
4) Ensure seamless blending at mask edges.

Edits:
${normalizedBase || 'Apply edits only within white areas.'}
${regionLines.length ? '\nSpecific regions:\n' + regionLines.join('\n') : ''}
[/EDIT_SPEC]
`.trim();
};

export const applyPromptTagSelection = (
  params: GenerationParams,
  mode: AppMode,
  resolveTagLabel: (tagKey: string) => string
): GenerationParams => {
  const selectedTags = mode === AppMode.IMAGE
    ? (params.selectedImageTags || [])
    : (params.selectedVideoTags || []);

  if (selectedTags.length === 0) {
    return params;
  }

  const tagTexts = selectedTags.map(tagKey => resolveTagLabel(tagKey) || tagKey).join(', ');
  return {
    ...params,
    prompt: params.prompt.trim()
      ? `${tagTexts}, ${params.prompt.trim()}`
      : tagTexts
  };
};

export const normalizeGenerationParamsForExecution = (
  params: GenerationParams,
  mode: AppMode,
  resolveTagLabel: (tagKey: string) => string
): GenerationParams => {
  const taggedParams = applyPromptTagSelection(params, mode, resolveTagLabel);
  const isEditMode = mode === AppMode.IMAGE && !!taggedParams.editBaseImage && !!taggedParams.editMask;

  if (!isEditMode) {
    return taggedParams;
  }

  return {
    ...taggedParams,
    smartAssets: [],
    prompt: buildEditPrompt(taggedParams.prompt, taggedParams.editRegions)
  };
};

export const buildOptimizationPlan = (overrides?: Partial<RevisionPlan>): RevisionPlan => ({
  summary: overrides?.summary || 'I can continue optimizing the current result while preserving the overall composition and lighting.',
  preserve: overrides?.preserve || ['composition', 'lighting', 'overall visual direction'],
  adjust: overrides?.adjust || ['subject fidelity', 'product clarity'],
  confidence: overrides?.confidence || 'medium',
  executionMode: overrides?.executionMode || 'auto',
  issueTypes: overrides?.issueTypes || ['other'],
  hardConstraints: overrides?.hardConstraints || [],
  preferredContinuity: overrides?.preferredContinuity || ['composition', 'lighting', 'overall visual direction'],
  localized: overrides?.localized || {
    zh: {
      summary: '我可以继续优化当前结果，同时保持整体构图和光影方向不变。',
      preserve: ['构图', '光影', '整体视觉方向'],
      adjust: ['主体还原度', '产品清晰度']
    },
    en: {
      summary: 'I can continue optimizing the current result while preserving the overall composition and lighting.',
      preserve: ['composition', 'lighting', 'overall visual direction'],
      adjust: ['subject fidelity', 'product clarity']
    }
  }
});

export const buildRequiresActionPayload = (
  prompt: string,
  review: Pick<GenerationReviewPayload, 'summary' | 'warnings' | 'revisedPrompt' | 'reviewPlan' | 'reviewTrace' | 'quality' | 'issues'>,
  i18n?: RequiresActionPayloadI18n,
  extra?: Record<string, unknown>
): Record<string, unknown> => ({
  prompt,
  revisedPrompt: review.revisedPrompt,
  warnings: review.warnings,
  issues: review.issues,
  quality: review.quality,
  reviewPlan: review.reviewPlan,
  reviewTrace: review.reviewTrace,
  titleI18n: i18n?.title,
  messageI18n: i18n?.message,
  warningsI18n: i18n?.warnings,
  availableActions: [
    { type: 'continue_optimization', label: 'Continue' },
    { type: 'dismiss', label: 'Keep Current' }
  ],
  recommendedAction: 'continue_optimization',
  ...extra
});

export const buildDefaultPrimaryReviewRequiresAction = ({
  prompt,
  review
}: {
  prompt: string;
  review: Pick<GenerationReviewPayload, 'summary' | 'warnings' | 'revisedPrompt' | 'reviewPlan' | 'reviewTrace' | 'quality' | 'issues'>;
}) => ({
  type: 'review_output',
  message: 'I already know the next refinement I would make. If you want, I can continue from here.',
  payload: buildRequiresActionPayload(prompt, {
    ...review,
    reviewPlan: review.reviewPlan || buildOptimizationPlan({
      summary: 'I can preserve the current result and continue with a focused refinement pass.',
      confidence: 'medium',
      localized: {
        zh: {
          summary: '我可以保留当前结果，并继续执行一轮更聚焦的优化。',
          preserve: ['当前结果方向'],
          adjust: ['局部优化重点']
        },
        en: {
          summary: 'I can preserve the current result and continue with a focused refinement pass.',
          preserve: ['current result direction'],
          adjust: ['targeted refinements']
        }
      }
    })
  }, {
    message: {
      zh: '我已经整理好下一步优化方向了。如果你愿意，我可以继续。',
      en: 'I already know the next refinement I would make. If you want, I can continue from here.'
    }
  })
});

export const buildDefaultRefinePromptRequiresAction = ({
  prompt,
  latestAssetId,
  review
}: {
  prompt: string;
  latestAssetId: string;
  review: Pick<GenerationReviewPayload, 'summary' | 'warnings' | 'revisedPrompt' | 'reviewPlan' | 'reviewTrace' | 'quality' | 'issues'>;
}) => ({
  type: 'refine_prompt',
  message: 'I already know how I would improve this version next. If you want, I can continue from here.',
  payload: buildRequiresActionPayload(prompt, {
    ...review,
    reviewPlan: review.reviewPlan || buildOptimizationPlan({
      summary: 'I can keep the current composition and continue improving the subject result.',
      adjust: ['subject fidelity'],
      confidence: 'medium',
      localized: {
        zh: {
          summary: '我可以保留当前构图，继续优化主体结果。',
          preserve: ['当前构图', '现有光影'],
          adjust: ['主体还原度']
        },
        en: {
          summary: 'I can keep the current composition and continue improving the subject result.',
          preserve: ['current composition', 'existing lighting'],
          adjust: ['subject fidelity']
        }
      }
    })
  }, {
    message: {
      zh: '我已经想好这一版接下来怎么优化了。如果你愿意，我可以继续。',
      en: 'I already know how I would improve this version next. If you want, I can continue from here.'
    }
  }, {
    latestAssetId
  })
});

export const buildRevisedToolResult = ({
  baseToolResult,
  revisedPrompt,
  revisionStepId,
  revisionReason,
  secondReview,
  secondReviewStepId
}: {
  baseToolResult: AgentToolResult;
  revisedPrompt: string;
  revisionStepId: string;
  revisionReason: string;
  secondReview: GenerationReviewPayload;
  secondReviewStepId: string;
}): AgentToolResult => ({
  ...baseToolResult,
  metadata: {
    ...(baseToolResult.metadata || {}),
    revisedPrompt,
    revision: {
      stepId: revisionStepId,
      reason: revisionReason
    },
    review: {
      decision: secondReview.decision,
      summary: secondReview.summary,
      warnings: secondReview.warnings,
      issues: secondReview.issues,
      quality: secondReview.quality,
      trace: secondReview.reviewTrace,
      stepId: secondReviewStepId
    }
  }
});

export const createPendingGenerationAsset = ({
  taskId,
  projectId,
  mode,
  params,
  jobId,
  now
}: {
  taskId: string;
  projectId: string;
  mode: AppMode;
  params: GenerationParams;
  jobId: string;
  now: number;
}): AssetItem => ({
  id: taskId,
  projectId,
  type: mode === AppMode.IMAGE ? 'IMAGE' : 'VIDEO',
  url: '',
  prompt: params.prompt,
  createdAt: now,
  status: 'PENDING',
  isNew: true,
  jobId,
  metadata: {
    aspectRatio: params.aspectRatio,
    model: mode === AppMode.IMAGE ? params.imageModel : params.videoModel,
    style: mode === AppMode.IMAGE ? params.imageStyle : params.videoStyle,
    resolution: mode === AppMode.IMAGE ? params.imageResolution : params.videoResolution,
    duration: mode === AppMode.VIDEO ? params.videoDuration : undefined,
    usedGrounding: params.useGrounding
  }
});

export const createQueuedGenerationJob = ({
  jobId,
  projectId,
  mode,
  now,
  source,
  triggerMessageTimestamp,
  consistencyProfile,
  searchContext,
  generationStep,
  initialArtifacts,
  existingJob,
  resumeActionStep
}: {
  jobId: string;
  projectId: string;
  mode: AppMode;
  now: number;
  source: AgentJob['source'];
  triggerMessageTimestamp?: number;
  consistencyProfile?: ConsistencyProfile;
  searchContext?: AgentJob['searchContext'];
  generationStep: JobStep;
  initialArtifacts: JobArtifact[];
  existingJob?: AgentJob;
  resumeActionStep?: JobStep;
}): AgentJob => (
  existingJob
    ? {
      ...existingJob,
      updatedAt: now,
      status: 'queued',
      source: existingJob.source,
      triggerMessageTimestamp: triggerMessageTimestamp ?? existingJob.triggerMessageTimestamp,
      currentStepId: undefined,
      lastError: undefined,
      requiresAction: undefined,
      consistencyProfile,
      searchContext: searchContext || existingJob.searchContext,
      steps: [
        ...existingJob.steps,
        ...(resumeActionStep ? [resumeActionStep] : []),
        generationStep
      ],
      artifacts: mergeRuntimeArtifacts(existingJob.artifacts, initialArtifacts)
    }
    : {
      id: jobId,
      projectId,
      type: mode === AppMode.IMAGE ? 'IMAGE_GENERATION' : 'VIDEO_GENERATION',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      source,
      triggerMessageTimestamp,
      currentStepId: undefined,
      consistencyProfile,
      searchContext,
      steps: [generationStep],
      artifacts: initialArtifacts
    }
);

export const buildQueuedGenerationJobSnapshot = ({
  jobId,
  projectId,
  stepId,
  mode,
  now,
  source,
  triggerMessageTimestamp,
  consistencyProfile,
  searchContext,
  params,
  toolCall,
  selectedReferenceRecords,
  existingJob,
  resumeActionStep
}: {
  jobId: string;
  projectId: string;
  stepId: string;
  mode: AppMode;
  now: number;
  source: AgentJob['source'];
  triggerMessageTimestamp?: number;
  consistencyProfile?: ConsistencyProfile;
  searchContext?: AgentJob['searchContext'];
  params: GenerationParams;
  toolCall?: AgentAction;
  selectedReferenceRecords: SelectedReferenceRecord[];
  existingJob?: AgentJob;
  resumeActionStep?: JobStep;
}): AgentJob => {
  const initialArtifacts = [
    ...buildReferenceArtifacts(selectedReferenceRecords),
    ...buildSearchArtifacts(searchContext)
  ];

  return createQueuedGenerationJob({
    jobId,
    projectId,
    mode,
    now,
    source,
    triggerMessageTimestamp,
    consistencyProfile,
    searchContext,
    generationStep: createGenerationStep(stepId, mode, params, toolCall),
    initialArtifacts,
    existingJob,
    resumeActionStep
  });
};

export const prepareGenerationLaunch = ({
  taskId,
  jobId,
  stepId,
  projectId,
  mode,
  now,
  source,
  triggerMessageTimestamp,
  consistencyProfile,
  searchContext,
  params,
  toolCall,
  selectedReferenceRecords,
  existingJob,
  resumeActionStep
}: {
  taskId: string;
  jobId: string;
  stepId: string;
  projectId: string;
  mode: AppMode;
  now: number;
  source: AgentJob['source'];
  triggerMessageTimestamp?: number;
  consistencyProfile?: ConsistencyProfile;
  searchContext?: AgentJob['searchContext'];
  params: GenerationParams;
  toolCall?: AgentAction;
  selectedReferenceRecords: SelectedReferenceRecord[];
  existingJob?: AgentJob;
  resumeActionStep?: JobStep;
}) => ({
  pendingAsset: createPendingGenerationAsset({
    taskId,
    projectId,
    mode,
    params,
    jobId,
    now
  }),
  queuedJob: buildQueuedGenerationJobSnapshot({
    jobId,
    projectId,
    stepId,
    mode,
    now,
    source,
    triggerMessageTimestamp,
    consistencyProfile,
    searchContext,
    params,
    toolCall,
    selectedReferenceRecords,
    existingJob,
    resumeActionStep
  })
});

export const buildRevisionArtifact = (
  artifactId: string,
  stepId: string,
  review: GenerationReviewPayload,
  previousPrompt: string,
  now = Date.now()
): JobArtifact => ({
  id: artifactId,
  type: 'text',
  origin: 'system',
  role: 'review_note',
  createdAt: now,
  relatedStepId: stepId,
  metadata: {
    previousPrompt,
    revisedPrompt: review.revisedPrompt || previousPrompt,
    revisionReason: review.revisionReason || review.summary
  }
});

export const finalizeReviewStep = <T extends JobStep>(
  reviewStep: T,
  review: GenerationReviewPayload,
  endedAt: number
): T => ({
  ...reviewStep,
  status: (review.decision === 'accept' ? 'success' : 'failed') as T['status'],
  endTime: endedAt,
  output: {
    decision: review.decision,
    summary: review.summary,
    warnings: review.warnings,
    issues: review.issues,
    quality: review.quality,
    trace: review.reviewTrace
  },
  error: review.decision === 'accept' ? undefined : review.summary
});

export const createReviewedToolResult = (
  toolResult: AgentToolResult,
  review: GenerationReviewPayload,
  reviewStepId: string,
  options?: {
    artifactIds?: string[];
    acceptStatus?: AgentToolResultStatus;
    nonAcceptStatus?: AgentToolResultStatus;
    requiresAction?: AgentToolResult['requiresAction'];
  }
): AgentToolResult => ({
  ...toolResult,
  ...(options?.artifactIds ? { artifactIds: options.artifactIds } : {}),
  status: review.decision === 'accept'
    ? (options?.acceptStatus || toolResult.status)
    : (options?.nonAcceptStatus || (review.decision === 'requires_action' ? 'requires_action' : 'error')),
  error: review.decision === 'accept' ? toolResult.error : review.summary,
  requiresAction: review.decision === 'accept'
    ? undefined
    : (options?.requiresAction ?? review.requiresAction),
  metadata: {
    ...(toolResult.metadata || {}),
    review: {
      decision: review.decision,
      summary: review.summary,
      warnings: review.warnings,
      issues: review.issues,
      quality: review.quality,
      trace: review.reviewTrace,
      stepId: reviewStepId
      }
  }
});

export const finalizeReviewOutcome = ({
  artifactId,
  reviewStep,
  review,
  toolResult,
  endedAt,
  toolResultOptions
}: {
  artifactId: string;
  reviewStep: JobStep;
  review: GenerationReviewPayload;
  toolResult: AgentToolResult;
  endedAt: number;
  toolResultOptions?: {
    artifactIds?: string[];
    acceptStatus?: AgentToolResultStatus;
    nonAcceptStatus?: AgentToolResultStatus;
    requiresAction?: AgentToolResult['requiresAction'];
  };
}) => ({
  reviewArtifact: buildReviewNoteArtifact({
    artifactId,
    stepId: reviewStep.id,
    review
  }),
  finalizedReviewStep: finalizeReviewStep(reviewStep, review, endedAt),
  reviewedToolResult: createReviewedToolResult(toolResult, review, reviewStep.id, toolResultOptions)
});

export const markStepRunning = <T extends JobStep>(
  step: T,
  startedAt: number
): T => ({
  ...step,
  status: 'running' as T['status'],
  startTime: startedAt
});

export const finalizeStepSuccess = <T extends JobStep>(
  step: T,
  endedAt: number,
  output?: T['output']
): T => ({
  ...step,
  status: 'success' as T['status'],
  endTime: endedAt,
  ...(typeof output !== 'undefined' ? { output } : {})
});

export const buildDerivedGeneratedArtifact = (
  asset: AssetItem,
  stepId: string,
  parentArtifactId: string
): JobArtifact => buildGeneratedArtifact(asset, stepId, {
  parentArtifactId,
  metadata: {
    ...(asset.metadata || {}),
    runtimeKey: `generated:${asset.id}`,
    derivedFrom: parentArtifactId
  }
});

export const buildGenerationExecutionSnapshot = (
  job: AgentJob,
  {
    stepId,
    now
  }: {
    stepId: string;
    now: number;
  }
): AgentJob => startAgentJobExecution(job, {
  stepId,
  now
});

export const prepareGenerationExecution = ({
  job,
  stepId,
  taskId,
  now
}: {
  job: AgentJob;
  stepId: string;
  taskId: string;
  now: number;
}) => ({
  runningJob: buildGenerationExecutionSnapshot(job, {
    stepId,
    now
  }),
  assetPatch: { status: 'GENERATING' as const },
  assetViewPatch: { status: 'GENERATING' as const },
  metadata: {
    taskId
  }
});

export const createRunningReviewStep = (
  reviewStepId: string,
  toolResult: AgentToolResult,
  startedAt: number
): JobStep => markStepRunning(createReviewStep(reviewStepId, toolResult), startedAt);

export const buildPrimaryReviewStartSnapshot = (
  job: AgentJob,
  {
    reviewStep,
    generatedArtifact,
    now
  }: {
    reviewStep: JobStep;
    generatedArtifact: JobArtifact;
    now: number;
  }
): AgentJob => startAgentJobReview(job, {
  reviewStep,
  generatedArtifact,
  now
});

export const preparePrimaryReview = ({
  job,
  asset,
  generationStepId,
  reviewStepId,
  toolResult,
  startedAt
}: {
  job: AgentJob;
  asset: AssetItem;
  generationStepId: string;
  reviewStepId: string;
  toolResult: AgentToolResult;
  startedAt: number;
}) => {
  const generatedArtifact = buildGeneratedAssetArtifact({
    asset,
    stepId: generationStepId
  });
  const reviewStep = createRunningReviewStep(reviewStepId, toolResult, startedAt);

  return {
    generatedArtifact,
    reviewStep,
    reviewingJob: buildPrimaryReviewStartSnapshot(job, {
      reviewStep,
      generatedArtifact,
      now: startedAt
    })
  };
};

export const buildGenerationOperationSnapshot = (
  job: AgentJob,
  {
    stepId,
    operationName,
    now
  }: {
    stepId: string;
    operationName: string;
    now: number;
  }
): AgentJob => mergeAgentJobStepOutput(job, {
  stepId,
  output: { operationName },
  now
});

export const prepareGenerationOperationUpdate = ({
  job,
  stepId,
  taskId,
  operationName,
  now
}: {
  job: AgentJob;
  stepId: string;
  taskId: string;
  operationName: string;
  now: number;
}) => ({
  jobWithOperation: buildGenerationOperationSnapshot(job, {
    stepId,
    operationName,
    now
  }),
  assetPatch: { operationName },
  metadata: {
    taskId
  }
});

export const buildGenerationCompletionSnapshot = (
  job: AgentJob,
  {
    stepId,
    asset,
    now,
    extraOutput
  }: {
    stepId: string;
    asset: AssetItem;
    now: number;
    extraOutput?: Record<string, unknown>;
  }
): AgentJob => succeedAgentJobStep(job, {
  stepId,
  output: {
    assetId: asset.id,
    assetType: asset.type,
    ...(extraOutput || {})
  },
  now
});

export const prepareCompletedGeneration = ({
  job,
  stepId,
  taskId,
  toolName,
  asset,
  now,
  extraOutput,
  extraMetadata,
  message
}: {
  job: AgentJob;
  stepId: string;
  taskId: string;
  toolName: AgentToolResult['toolName'];
  asset: AssetItem;
  now: number;
  extraOutput?: Record<string, unknown>;
  extraMetadata?: Record<string, unknown>;
  message?: string;
}) => ({
  completedJob: buildGenerationCompletionSnapshot(job, {
    stepId,
    asset,
    now,
    extraOutput
  }),
  toolResult: {
    jobId: job.id,
    stepId,
    toolName,
    status: 'success' as const,
    artifactIds: [asset.id],
    message: message || `${toolName} completed`,
    metadata: {
      assetId: asset.id,
      taskId,
      ...(extraMetadata || {})
    }
  }
});

export const buildGeneratedAssetArtifact = ({
  asset,
  stepId
}: {
  asset: AssetItem;
  stepId: string;
}): JobArtifact => buildGeneratedArtifact(asset, stepId);

export const buildReviewNoteArtifact = ({
  artifactId,
  stepId,
  review
}: {
  artifactId: string;
  stepId: string;
  review: GenerationReviewPayload;
}): JobArtifact => buildReviewArtifact(artifactId, stepId, review);

export const createRunningRevisionStep = ({
  stepId,
  review,
  previousPrompt,
  startedAt
}: {
  stepId: string;
  review: GenerationReviewPayload;
  previousPrompt: string;
  startedAt: number;
}): JobStep => markStepRunning(createRevisionStep(stepId, review, previousPrompt), startedAt);

export const createRunningGenerationStep = ({
  stepId,
  mode,
  params,
  toolCall,
  startedAt
}: {
  stepId: string;
  mode: AppMode;
  params: GenerationParams;
  toolCall?: AgentAction;
  startedAt: number;
}): JobStep => markStepRunning(createGenerationStep(stepId, mode, params, toolCall), startedAt);

export const buildAutoRevisionSnapshot = (
  job: AgentJob,
  {
    revisionStep,
    finalizedReviewStep,
    reviewArtifact,
    revisionArtifact,
    now
  }: {
    revisionStep: JobStep;
    finalizedReviewStep: JobStep;
    reviewArtifact: JobArtifact;
    revisionArtifact: JobArtifact;
    now: number;
  }
): AgentJob => ({
  ...job,
  status: 'revising',
  currentStepId: revisionStep.id,
  lastError: undefined,
  updatedAt: now,
  steps: [
    ...job.steps.filter(step => step.id !== finalizedReviewStep.id && step.id !== revisionStep.id),
    finalizedReviewStep,
    revisionStep
  ],
  artifacts: [...job.artifacts, reviewArtifact, revisionArtifact]
});

export const buildAutoRevisionExecutionHandoff = ({
  job,
  review,
  currentMode,
  originalPrompt,
  genParams,
  toolCall,
  finalizedReviewStep,
  reviewArtifact,
  revisionStepId,
  revisionArtifactId,
  revisedGenerationStepId,
  revisionStartedAt,
  now
}: {
  job: AgentJob;
  review: GenerationReviewPayload;
  currentMode: AppMode;
  originalPrompt: string;
  genParams: GenerationParams;
  toolCall?: AgentAction;
  finalizedReviewStep: JobStep;
  reviewArtifact: JobArtifact;
  revisionStepId: string;
  revisionArtifactId: string;
  revisedGenerationStepId: string;
  revisionStartedAt: number;
  now: number;
}) => {
  const revisionStep = createRunningRevisionStep({
    stepId: revisionStepId,
    review,
    previousPrompt: originalPrompt,
    startedAt: revisionStartedAt
  });
  const revisionArtifact = buildRevisionArtifact(revisionArtifactId, revisionStepId, review, originalPrompt);
  const completedRevisionStep = finalizeStepSuccess(revisionStep, now, {
    revisedPrompt: review.revisedPrompt || originalPrompt,
    revisionReason: review.revisionReason || review.summary
  });
  const revisingJob = buildAutoRevisionSnapshot(job, {
    revisionStep: completedRevisionStep,
    finalizedReviewStep,
    reviewArtifact,
    revisionArtifact,
    now
  });
  const stepsAfterRevision = revisingJob.steps;
  const revisedPrompt = review.revisedPrompt || originalPrompt;
  const revisedParams: GenerationParams = {
    ...genParams,
    prompt: revisedPrompt
  };
  const revisedGenerationStep = createRunningGenerationStep({
    stepId: revisedGenerationStepId,
    mode: currentMode,
    params: revisedParams,
    toolCall,
    startedAt: now
  });
  const executingRevisionJob = buildAutoRevisionExecutionSnapshot(revisingJob, {
    stepsAfterRevision,
    revisedGenerationStep,
    artifacts: revisingJob.artifacts,
    now
  });

  return {
    revisionStep,
    revisionArtifact,
    completedRevisionStep,
    revisingJob,
    stepsAfterRevision,
    revisedPrompt,
    revisedParams,
    revisedGenerationStep,
    executingRevisionJob
  };
};

export const buildAutoRevisionExecutionSnapshot = (
  job: AgentJob,
  {
    stepsAfterRevision,
    revisedGenerationStep,
    artifacts,
    now
  }: {
    stepsAfterRevision: JobStep[];
    revisedGenerationStep: JobStep;
    artifacts: JobArtifact[];
    now: number;
  }
): AgentJob => ({
  ...job,
  status: 'executing',
  currentStepId: revisedGenerationStep.id,
  updatedAt: now,
  steps: [...stepsAfterRevision, revisedGenerationStep],
  artifacts
});

export const buildAutoRevisionReviewSnapshot = (
  job: AgentJob,
  {
    stepsAfterRevision,
    finalizedRevisedGenerationStep,
    secondReviewStep,
    artifacts,
    now
  }: {
    stepsAfterRevision: JobStep[];
    finalizedRevisedGenerationStep: JobStep;
    secondReviewStep: JobStep;
    artifacts: JobArtifact[];
    now: number;
  }
): AgentJob => ({
  ...job,
  status: 'reviewing',
  currentStepId: secondReviewStep.id,
  updatedAt: now,
  steps: [...stepsAfterRevision, finalizedRevisedGenerationStep, secondReviewStep],
  artifacts
});

export const buildAutoRevisionReviewHandoff = ({
  executingRevisionJob,
  stepsAfterRevision,
  revisedGenerationStep,
  revisedGenerationStepId,
  revisedAsset,
  parentArtifactId,
  secondReviewStepId,
  toolResult,
  now
}: {
  executingRevisionJob: AgentJob;
  stepsAfterRevision: JobStep[];
  revisedGenerationStep: JobStep;
  revisedGenerationStepId: string;
  revisedAsset: AssetItem;
  parentArtifactId: string;
  secondReviewStepId: string;
  toolResult: AgentToolResult;
  now: number;
}) => {
  const finalizedRevisedGenerationStep = finalizeStepSuccess(revisedGenerationStep, now, {
    assetId: revisedAsset.id,
    assetType: revisedAsset.type
  });
  const revisedGeneratedArtifact = buildDerivedGeneratedArtifact(revisedAsset, revisedGenerationStepId, parentArtifactId);
  const secondReviewStep = createRunningReviewStep(secondReviewStepId, {
    ...toolResult,
    artifactIds: [revisedAsset.id]
  }, now);
  const reviewingRevisionJob = buildAutoRevisionReviewSnapshot(executingRevisionJob, {
    stepsAfterRevision,
    finalizedRevisedGenerationStep,
    secondReviewStep,
    artifacts: [...executingRevisionJob.artifacts, revisedGeneratedArtifact],
    now
  });

  return {
    finalizedRevisedGenerationStep,
    revisedGeneratedArtifact,
    secondReviewStep,
    reviewingRevisionJob
  };
};

export const buildPrimaryReviewRequiresActionSnapshot = (
  job: AgentJob,
  {
    finalizedReviewStep,
    generatedArtifact,
    reviewArtifact,
    lastError,
    requiresAction,
    now
  }: {
    finalizedReviewStep: JobStep;
    generatedArtifact: JobArtifact;
    reviewArtifact: JobArtifact;
    lastError: string;
    requiresAction: NonNullable<AgentJob['requiresAction']>;
    now: number;
  }
): AgentJob => requireAgentJobAction(job, {
  now,
  lastError,
  requiresAction,
  steps: [...job.steps.filter(step => step.id !== finalizedReviewStep.id), finalizedReviewStep],
  artifacts: [...job.artifacts, generatedArtifact, reviewArtifact]
});

export const buildPrimaryReviewCompletedSnapshot = (
  job: AgentJob,
  {
    finalizedReviewStep,
    generatedArtifact,
    reviewArtifact,
    now
  }: {
    finalizedReviewStep: JobStep;
    generatedArtifact: JobArtifact;
    reviewArtifact: JobArtifact;
    now: number;
  }
): AgentJob => completeAgentJob(job, {
  now,
  steps: [...job.steps.filter(step => step.id !== finalizedReviewStep.id), finalizedReviewStep],
  artifacts: [...job.artifacts, generatedArtifact, reviewArtifact]
});

export const preparePrimaryReviewResolution = ({
  job,
  finalizedReviewStep,
  generatedArtifact,
  reviewArtifact,
  review,
  prompt,
  now
}: {
  job: AgentJob;
  finalizedReviewStep: JobStep;
  generatedArtifact: JobArtifact;
  reviewArtifact: JobArtifact;
  review: GenerationReviewPayload;
  prompt: string;
  now: number;
}) => {
  if (review.decision === 'requires_action') {
    return {
      resolution: 'requires_action' as const,
      resolvedJob: buildPrimaryReviewRequiresActionSnapshot(job, {
        finalizedReviewStep,
        generatedArtifact,
        reviewArtifact,
        lastError: review.summary,
        requiresAction: review.requiresAction || buildDefaultPrimaryReviewRequiresAction({
          prompt,
          review
        }),
        now
      })
    };
  }

  return {
    resolution: 'completed' as const,
    resolvedJob: buildPrimaryReviewCompletedSnapshot(job, {
      finalizedReviewStep,
      generatedArtifact,
      reviewArtifact,
      now
    })
  };
};

export const buildAutoRevisionRequiresActionSnapshot = (
  job: AgentJob,
  {
    stepsAfterRevision,
    finalizedRevisedGenerationStep,
    finalizedSecondReviewStep,
    generatedArtifact,
    reviewArtifact,
    revisionArtifact,
    revisedGeneratedArtifact,
    secondReviewArtifact,
    lastError,
    requiresAction,
    now
  }: {
    stepsAfterRevision: JobStep[];
    finalizedRevisedGenerationStep: JobStep;
    finalizedSecondReviewStep: JobStep;
    generatedArtifact: JobArtifact;
    reviewArtifact: JobArtifact;
    revisionArtifact: JobArtifact;
    revisedGeneratedArtifact: JobArtifact;
    secondReviewArtifact: JobArtifact;
    lastError: string;
    requiresAction: NonNullable<AgentJob['requiresAction']>;
    now: number;
  }
): AgentJob => requireAgentJobAction(job, {
  now,
  lastError,
  requiresAction,
  steps: [...stepsAfterRevision, finalizedRevisedGenerationStep, finalizedSecondReviewStep],
  artifacts: [...job.artifacts, generatedArtifact, reviewArtifact, revisionArtifact, revisedGeneratedArtifact, secondReviewArtifact]
});

export const buildAutoRevisionCompletedSnapshot = (
  job: AgentJob,
  {
    stepsAfterRevision,
    finalizedRevisedGenerationStep,
    finalizedSecondReviewStep,
    generatedArtifact,
    reviewArtifact,
    revisionArtifact,
    revisedGeneratedArtifact,
    secondReviewArtifact,
    now
  }: {
    stepsAfterRevision: JobStep[];
    finalizedRevisedGenerationStep: JobStep;
    finalizedSecondReviewStep: JobStep;
    generatedArtifact: JobArtifact;
    reviewArtifact: JobArtifact;
    revisionArtifact: JobArtifact;
    revisedGeneratedArtifact: JobArtifact;
    secondReviewArtifact: JobArtifact;
    now: number;
  }
): AgentJob => completeAgentJob(job, {
  now,
  steps: [...stepsAfterRevision, finalizedRevisedGenerationStep, finalizedSecondReviewStep],
  artifacts: [...job.artifacts, generatedArtifact, reviewArtifact, revisionArtifact, revisedGeneratedArtifact, secondReviewArtifact]
});

export const prepareAutoRevisionResolution = ({
  job,
  stepsAfterRevision,
  finalizedRevisedGenerationStep,
  finalizedSecondReviewStep,
  generatedArtifact,
  reviewArtifact,
  revisionArtifact,
  revisedGeneratedArtifact,
  secondReviewArtifact,
  secondReview,
  revisedPrompt,
  revisedAssetId,
  revisedToolResultRequiresAction,
  now
}: {
  job: AgentJob;
  stepsAfterRevision: JobStep[];
  finalizedRevisedGenerationStep: JobStep;
  finalizedSecondReviewStep: JobStep;
  generatedArtifact: JobArtifact;
  reviewArtifact: JobArtifact;
  revisionArtifact: JobArtifact;
  revisedGeneratedArtifact: JobArtifact;
  secondReviewArtifact: JobArtifact;
  secondReview: GenerationReviewPayload;
  revisedPrompt: string;
  revisedAssetId: string;
  revisedToolResultRequiresAction?: AgentToolResult['requiresAction'];
  now: number;
}) => {
  if (secondReview.decision !== 'accept') {
    return {
      resolution: 'requires_action' as const,
      resolvedJob: buildAutoRevisionRequiresActionSnapshot(job, {
        stepsAfterRevision,
        finalizedRevisedGenerationStep,
        finalizedSecondReviewStep,
        generatedArtifact,
        reviewArtifact,
        revisionArtifact,
        revisedGeneratedArtifact,
        secondReviewArtifact,
        lastError: secondReview.summary,
        requiresAction: revisedToolResultRequiresAction || buildDefaultRefinePromptRequiresAction({
          prompt: revisedPrompt,
          latestAssetId: revisedAssetId,
          review: secondReview
        }),
        now
      })
    };
  }

  return {
    resolution: 'completed' as const,
    resolvedJob: buildAutoRevisionCompletedSnapshot(job, {
      stepsAfterRevision,
      finalizedRevisedGenerationStep,
      finalizedSecondReviewStep,
      generatedArtifact,
      reviewArtifact,
      revisionArtifact,
      revisedGeneratedArtifact,
      secondReviewArtifact,
      now
    })
  };
};

export const buildCancelledGenerationSnapshot = (
  job: AgentJob,
  {
    stepId,
    now,
    reason
  }: {
    stepId: string;
    now: number;
    reason: string;
  }
): AgentJob => cancelAgentJob(job, {
  stepId,
  reason,
  now
});

export const buildVisibleAssetRecoverySnapshot = (
  job: AgentJob,
  {
    now,
    lastError
  }: {
    now: number;
    lastError: string;
  }
): AgentJob => completeAgentJob(job, {
  now,
  lastError
});

export const buildFailedGenerationSnapshot = (
  job: AgentJob,
  {
    stepId,
    error,
    now
  }: {
    stepId: string;
    error: string;
    now: number;
  }
): AgentJob => failAgentJob(job, {
  stepId,
  error,
  now
});

export const prepareCancelledGeneration = ({
  job,
  stepId,
  taskId,
  toolName,
  reason,
  now
}: {
  job: AgentJob;
  stepId: string;
  taskId: string;
  toolName: AgentToolResult['toolName'];
  reason: string;
  now: number;
}) => ({
  cancelledJob: buildCancelledGenerationSnapshot(job, {
    stepId,
    reason,
    now
  }),
  toolResult: {
    jobId: job.id,
    stepId,
    toolName,
    status: 'error' as const,
    error: reason,
    retryable: false,
    metadata: {
      taskId,
      lifecycleStatus: 'cancelled'
    }
  }
});

export const prepareVisibleAssetRecovery = ({
  job,
  stepId,
  taskId,
  toolName,
  assetId,
  error,
  now
}: {
  job: AgentJob;
  stepId: string;
  taskId: string;
  toolName: AgentToolResult['toolName'];
  assetId: string;
  error: string;
  now: number;
}) => ({
  recoveredJob: buildVisibleAssetRecoverySnapshot(job, {
    now,
    lastError: error
  }),
  toolResult: {
    jobId: job.id,
    stepId,
    toolName,
    status: 'success' as const,
    artifactIds: [assetId],
    message: 'Image generation completed',
    metadata: {
      taskId,
      assetId,
      lifecycleStatus: 'completed',
      reviewError: error
    }
  }
});

export const prepareFailedGeneration = ({
  job,
  stepId,
  taskId,
  toolName,
  error,
  retryable,
  now
}: {
  job: AgentJob;
  stepId: string;
  taskId: string;
  toolName: AgentToolResult['toolName'];
  error: string;
  retryable: boolean;
  now: number;
}) => ({
  failedJob: buildFailedGenerationSnapshot(job, {
    stepId,
    error,
    now
  }),
  toolResult: {
    jobId: job.id,
    stepId,
    toolName,
    status: 'error' as const,
    error,
    retryable,
    metadata: {
      taskId,
      lifecycleStatus: 'failed'
    }
  }
});
