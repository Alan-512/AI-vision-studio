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
import { buildAutoRevisionExecutionSnapshot, buildAutoRevisionReviewSnapshot, buildAutoRevisionSnapshot, buildGeneratedArtifact, buildPrimaryReviewStartSnapshot, buildQueuedGenerationJobSnapshot, buildReviewArtifact, createGenerationStep, createReviewStep, createRevisionStep, type SelectedReferenceRecord } from './agentRuntime';

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

export const createRunningReviewStep = (
  reviewStepId: string,
  toolResult: AgentToolResult,
  startedAt: number
): JobStep => markStepRunning(createReviewStep(reviewStepId, toolResult), startedAt);

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
