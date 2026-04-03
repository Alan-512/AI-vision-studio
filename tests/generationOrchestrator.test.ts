import { describe, expect, it } from 'vitest';
import {
  AppMode,
  AspectRatio,
  AssistantMode,
  EditRegion,
  GenerationParams,
  ImageModel,
  ImageResolution,
  ImageStyle,
  VideoDuration,
  VideoModel,
  VideoResolution,
  VideoStyle,
  type AgentAction,
  type AgentJob,
  type ConsistencyProfile,
  type JobArtifact,
  type JobStep
} from '../types';
import {
  applyPromptTagSelection,
  buildAutoRevisionExecutionHandoff,
  buildAutoRevisionExecutionSnapshot,
  buildAutoRevisionReviewHandoff,
  buildCancelledGenerationSnapshot,
  buildGeneratedAssetArtifact,
  buildGenerationCompletionSnapshot,
  buildGenerationExecutionSnapshot,
  buildGenerationOperationSnapshot,
  buildAutoRevisionRequiresActionSnapshot,
  buildAutoRevisionReviewSnapshot,
  buildAutoRevisionSnapshot,
  buildAutoRevisionCompletedSnapshot,
  buildQueuedGenerationJobSnapshot,
  buildDerivedGeneratedArtifact,
  buildEditPrompt,
  buildFailedGenerationSnapshot,
  buildOptimizationPlan,
  buildReviewNoteArtifact,
  buildRequiresActionPayload,
  buildDefaultPrimaryReviewRequiresAction,
  buildDefaultRefinePromptRequiresAction,
  buildRevisedToolResult,
  prepareGenerationLaunch,
  buildPrimaryReviewStartSnapshot,
  buildPrimaryReviewCompletedSnapshot,
  buildPrimaryReviewRequiresActionSnapshot,
  prepareAutoRevisionResolution,
  preparePrimaryReviewResolution,
  prepareCancelledGeneration,
  prepareCompletedGeneration,
  prepareFailedGeneration,
  prepareGenerationExecution,
  prepareGenerationOperationUpdate,
  preparePrimaryReview,
  prepareVisibleAssetRecovery,
  buildVisibleAssetRecoverySnapshot,
  createRunningGenerationStep,
  createRunningReviewStep,
  createRunningRevisionStep,
  finalizeReviewOutcome,
  buildRevisionArtifact,
  createReviewedToolResult,
  createPendingGenerationAsset,
  createQueuedGenerationJob,
  finalizeReviewStep,
  finalizeStepSuccess,
  markStepRunning,
  normalizeGenerationParamsForExecution
} from '../services/generationOrchestrator';

const createParams = (): GenerationParams => ({
  prompt: 'cinematic poster',
  savedImagePrompt: '',
  savedVideoPrompt: '',
  aspectRatio: AspectRatio.SQUARE,
  imageModel: ImageModel.FLASH_3_1,
  videoModel: VideoModel.VEO_FAST,
  imageStyle: ImageStyle.NONE,
  videoStyle: VideoStyle.NONE,
  imageResolution: ImageResolution.RES_1K,
  videoResolution: VideoResolution.RES_720P,
  videoDuration: VideoDuration.SHORT,
  useGrounding: false,
  smartAssets: []
});

const createBaseJob = (): AgentJob => ({
  id: 'job-1',
  projectId: 'project-1',
  type: 'IMAGE_GENERATION',
  status: 'reviewing',
  createdAt: 100,
  updatedAt: 100,
  source: 'studio',
  steps: [{
    id: 'generate-1',
    kind: 'generation',
    name: 'generate_image',
    status: 'success',
    output: {
      assetId: 'asset-1',
      assetType: 'IMAGE'
    }
  }],
  artifacts: [{
    id: 'generated-1',
    type: 'image',
    origin: 'tool',
    role: 'generated_asset',
    createdAt: 100,
    relatedStepId: 'generate-1'
  }]
});

describe('generationOrchestrator helpers', () => {
  it('builds an edit prompt with region instructions', () => {
    const regions: EditRegion[] = [
      {
        id: 'A',
        instruction: 'replace sky',
        maskData: 'mask-a',
        maskMimeType: 'image/png'
      }
    ];

    expect(buildEditPrompt('add clouds', regions)).toContain('Region A: replace sky');
    expect(buildEditPrompt('add clouds', regions)).toContain('add clouds');
  });

  it('applies selected prompt tags for the active mode', () => {
    const tagged = applyPromptTagSelection(createParams(), AppMode.IMAGE, tag => ({
      'tag-light': 'soft light',
      'tag-shot': 'editorial shot'
    }[tag] || tag));

    expect(tagged.prompt).toBe('cinematic poster');

    const imageTagged = applyPromptTagSelection({
      ...createParams(),
      selectedImageTags: ['tag-light', 'tag-shot']
    }, AppMode.IMAGE, tag => ({
      'tag-light': 'soft light',
      'tag-shot': 'editorial shot'
    }[tag] || tag));

    expect(imageTagged.prompt).toBe('soft light, editorial shot, cinematic poster');
  });

  it('normalizes edit-mode params by clearing smart assets and wrapping the prompt', () => {
    const normalized = normalizeGenerationParamsForExecution({
      ...createParams(),
      smartAssets: [{ id: 'asset-1', data: 'abc', mimeType: 'image/png' }],
      editBaseImage: { id: 'base', data: 'base64', mimeType: 'image/png' },
      editMask: { id: 'mask', data: 'mask64', mimeType: 'image/png' },
      editRegions: [{
        id: 'R1',
        instruction: 'change outfit',
        maskData: 'mask',
        maskMimeType: 'image/png'
      }]
    }, AppMode.IMAGE, tag => tag);

    expect(normalized.smartAssets).toEqual([]);
    expect(normalized.prompt).toContain('[EDIT_SPEC]');
    expect(normalized.prompt).toContain('Region R1: change outfit');
  });

  it('creates a pending generation asset with runtime metadata', () => {
    const asset = createPendingGenerationAsset({
      taskId: 'task-1',
      projectId: 'project-1',
      mode: AppMode.IMAGE,
      params: createParams(),
      jobId: 'job-1',
      now: 123
    });

    expect(asset).toEqual({
      id: 'task-1',
      projectId: 'project-1',
      type: 'IMAGE',
      url: '',
      prompt: 'cinematic poster',
      createdAt: 123,
      status: 'PENDING',
      isNew: true,
      jobId: 'job-1',
      metadata: {
        aspectRatio: AspectRatio.SQUARE,
        model: ImageModel.FLASH_3_1,
        style: ImageStyle.NONE,
        resolution: ImageResolution.RES_1K,
        duration: undefined,
        usedGrounding: false
      }
    });
  });

  it('creates a queued generation job for new and resumed runs', () => {
    const consistencyProfile: ConsistencyProfile = {
      preserveSignals: ['composition'],
      hardConstraints: ['subject'],
      preferredContinuity: ['lighting'],
      updatedAt: 123,
      assistantMode: AssistantMode.POSTER
    };
    const generationStep: JobStep = {
      id: 'step-1',
      kind: 'generation',
      name: 'generate_image',
      status: 'pending',
      input: { prompt: 'poster' }
    };
    const initialArtifacts: JobArtifact[] = [{
      id: 'artifact-1',
      type: 'json',
      origin: 'search',
      role: 'retrieved_context',
      createdAt: 100
    }];

    const newJob = createQueuedGenerationJob({
      jobId: 'job-new',
      projectId: 'project-1',
      mode: AppMode.IMAGE,
      now: 200,
      source: 'studio',
      triggerMessageTimestamp: 300,
      consistencyProfile,
      searchContext: {
        queries: ['poster']
      },
      generationStep,
      initialArtifacts
    });

    expect(newJob).toMatchObject({
      id: 'job-new',
      type: 'IMAGE_GENERATION',
      status: 'queued',
      createdAt: 200,
      updatedAt: 200,
      source: 'studio',
      triggerMessageTimestamp: 300,
      consistencyProfile,
      steps: [generationStep],
      artifacts: initialArtifacts
    });

    const existingJob: AgentJob = {
      ...newJob,
      status: 'requires_action',
      updatedAt: 150,
      source: 'chat',
      triggerMessageTimestamp: 111,
      lastError: 'Need refinement',
      requiresAction: {
        type: 'review_output',
        message: 'Continue?'
      }
    };
    const resumeActionStep: JobStep = {
      id: 'resume-1',
      kind: 'system',
      name: 'resume_requires_action',
      status: 'success',
      input: {
        jobId: 'job-new'
      }
    };

    const resumedJob = createQueuedGenerationJob({
      jobId: 'job-new',
      projectId: 'project-1',
      mode: AppMode.IMAGE,
      now: 250,
      source: 'studio',
      triggerMessageTimestamp: 333,
      consistencyProfile,
      searchContext: {
        queries: ['resume']
      },
      generationStep,
      initialArtifacts,
      existingJob,
      resumeActionStep
    });

    expect(resumedJob).toMatchObject({
      id: 'job-new',
      status: 'queued',
      updatedAt: 250,
      source: 'chat',
      triggerMessageTimestamp: 333,
      currentStepId: undefined,
      lastError: undefined,
      requiresAction: undefined
    });
    expect(resumedJob.steps.slice(-2)).toEqual([resumeActionStep, generationStep]);
  });

  it('builds a queued generation snapshot from references, search context, and tool input', () => {
    const toolCall: AgentAction = {
      toolName: 'generate_image',
      args: {
        prompt: 'cinematic poster'
      }
    };
    const queuedJob = buildQueuedGenerationJobSnapshot({
      jobId: 'job-queued',
      projectId: 'project-1',
      stepId: 'step-queued',
      mode: AppMode.IMAGE,
      now: 222,
      source: 'studio',
      triggerMessageTimestamp: 333,
      consistencyProfile: {
        preserveSignals: ['composition'],
        hardConstraints: ['subject'],
        preferredContinuity: ['lighting'],
        updatedAt: 220,
        assistantMode: AssistantMode.POSTER
      },
      searchContext: {
        queries: ['cinematic poster'],
        facts: [{ item: 'Lighting: soft rim light' }],
        sources: [{ title: 'Ref', url: 'https://example.com/ref' }]
      },
      params: createParams(),
      toolCall,
      selectedReferenceRecords: [{
        asset: {
          id: 'user-1',
          mimeType: 'image/png',
          data: 'abc123'
        },
        sourceRole: 'user',
        messageTimestamp: 123
      }]
    });

    expect(queuedJob).toMatchObject({
      id: 'job-queued',
      projectId: 'project-1',
      status: 'queued',
      source: 'studio',
      triggerMessageTimestamp: 333,
      currentStepId: undefined,
      steps: [{
        id: 'step-queued',
        kind: 'generation',
        name: 'generate_image',
        status: 'pending',
        input: {
          prompt: 'cinematic poster',
          toolArgs: {
            prompt: 'cinematic poster'
          }
        }
      }]
    });
    expect(queuedJob.artifacts).toHaveLength(2);
    expect(queuedJob.artifacts[0]).toMatchObject({
      role: 'reference',
      metadata: {
        sourceImageId: 'user-1'
      }
    });
    expect(queuedJob.artifacts[1]).toMatchObject({
      role: 'retrieved_context',
      metadata: {
        queries: ['cinematic poster']
      }
    });
  });

  it('prepares launch state with queued job and pending asset from shared runtime inputs', () => {
    const toolCall: AgentAction = {
      toolName: 'generate_image',
      args: {
        prompt: 'cinematic poster'
      }
    };

    const launch = prepareGenerationLaunch({
      taskId: 'task-queued',
      jobId: 'job-queued',
      stepId: 'step-queued',
      projectId: 'project-1',
      mode: AppMode.IMAGE,
      now: 456,
      source: 'studio',
      triggerMessageTimestamp: 333,
      consistencyProfile: {
        preserveSignals: ['composition'],
        hardConstraints: ['subject'],
        preferredContinuity: ['lighting'],
        updatedAt: 220,
        assistantMode: AssistantMode.POSTER
      },
      searchContext: {
        queries: ['cinematic poster']
      },
      params: createParams(),
      toolCall,
      selectedReferenceRecords: [{
        asset: {
          id: 'user-1',
          mimeType: 'image/png',
          data: 'abc123'
        },
        sourceRole: 'user',
        messageTimestamp: 123
      }]
    });

    expect(launch.pendingAsset).toMatchObject({
      id: 'task-queued',
      projectId: 'project-1',
      status: 'PENDING',
      jobId: 'job-queued',
      prompt: 'cinematic poster'
    });
    expect(launch.queuedJob).toMatchObject({
      id: 'job-queued',
      projectId: 'project-1',
      status: 'queued',
      triggerMessageTimestamp: 333,
      consistencyProfile: {
        preserveSignals: ['composition']
      }
    });
    expect(launch.queuedJob.steps.at(-1)).toMatchObject({
      id: 'step-queued',
      kind: 'generation',
      status: 'pending'
    });
  });

  it('builds revision artifacts and finalized review steps from review payloads', () => {
    const finalizedReviewStep = finalizeReviewStep({
      id: 'review-step',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'running',
      startTime: 300
    }, {
      decision: 'requires_action',
      summary: 'needs refinement',
      warnings: ['flat lighting'],
      reviewTrace: {
        rawDecision: 'requires_action',
        finalDecision: 'requires_action',
        summary: 'needs refinement',
        preserve: [],
        adjust: []
      }
    }, 400);

    expect(finalizedReviewStep).toEqual({
      id: 'review-step',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'failed',
      startTime: 300,
      endTime: 400,
      output: {
        decision: 'requires_action',
        summary: 'needs refinement',
        warnings: ['flat lighting'],
        issues: undefined,
        quality: undefined,
        trace: {
          rawDecision: 'requires_action',
          finalDecision: 'requires_action',
          summary: 'needs refinement',
          preserve: [],
          adjust: []
        }
      },
      error: 'needs refinement'
    });

    const revisionArtifact = buildRevisionArtifact('artifact-1', 'revision-step', {
      decision: 'auto_revise',
      summary: 'shift the subject',
      warnings: [],
      revisedPrompt: 'stronger subject contrast',
      revisionReason: 'subject weak'
    }, 'old prompt', 500);

    expect(revisionArtifact).toEqual({
      id: 'artifact-1',
      type: 'text',
      origin: 'system',
      role: 'review_note',
      createdAt: 500,
      relatedStepId: 'revision-step',
      metadata: {
        previousPrompt: 'old prompt',
        revisedPrompt: 'stronger subject contrast',
        revisionReason: 'subject weak'
      }
    });
  });

  it('creates reviewed tool results with configurable terminal status', () => {
    const toolResult = {
      jobId: 'job-1',
      stepId: 'step-1',
      toolName: 'generate_image',
      status: 'success' as const,
      artifactIds: ['asset-1'],
      metadata: {
        source: 'base'
      }
    };

    expect(createReviewedToolResult(toolResult, {
      decision: 'requires_action',
      summary: 'continue refining',
      warnings: ['detail loss'],
      requiresAction: {
        type: 'review_output',
        message: 'Continue?'
      }
    }, 'review-step')).toEqual({
      ...toolResult,
      status: 'requires_action',
      error: 'continue refining',
      requiresAction: {
        type: 'review_output',
        message: 'Continue?'
      },
      metadata: {
        source: 'base',
        review: {
          decision: 'requires_action',
          summary: 'continue refining',
          warnings: ['detail loss'],
          issues: undefined,
          quality: undefined,
          trace: undefined,
          stepId: 'review-step'
        }
      }
    });

    expect(createReviewedToolResult(toolResult, {
      decision: 'accept',
      summary: 'looks good',
      warnings: []
    }, 'review-step', {
      artifactIds: ['asset-2'],
      acceptStatus: 'success',
      nonAcceptStatus: 'requires_action'
    })).toEqual({
      ...toolResult,
      artifactIds: ['asset-2'],
      status: 'success',
      error: undefined,
      requiresAction: undefined,
      metadata: {
        source: 'base',
        review: {
          decision: 'accept',
          summary: 'looks good',
          warnings: [],
          issues: undefined,
          quality: undefined,
          trace: undefined,
          stepId: 'review-step'
        }
      }
    });
  });

  it('marks steps running, finalizes step success, and builds derived generated artifacts', () => {
    const runningStep = markStepRunning({
      id: 'step-1',
      kind: 'generation',
      name: 'generate_image',
      status: 'pending',
      input: {
        prompt: 'poster'
      }
    }, 600);

    expect(runningStep).toEqual({
      id: 'step-1',
      kind: 'generation',
      name: 'generate_image',
      status: 'running',
      input: {
        prompt: 'poster'
      },
      startTime: 600
    });

    const finalizedStep = finalizeStepSuccess(runningStep, 700, {
      assetId: 'asset-1',
      assetType: 'IMAGE'
    });

    expect(finalizedStep).toEqual({
      id: 'step-1',
      kind: 'generation',
      name: 'generate_image',
      status: 'success',
      input: {
        prompt: 'poster'
      },
      startTime: 600,
      endTime: 700,
      output: {
        assetId: 'asset-1',
        assetType: 'IMAGE'
      }
    });

    const asset = createPendingGenerationAsset({
      taskId: 'asset-1',
      projectId: 'project-1',
      mode: AppMode.IMAGE,
      params: createParams(),
      jobId: 'job-1',
      now: 800
    });
    asset.url = 'data:image/png;base64,abc123';
    asset.status = 'COMPLETED';

    expect(buildDerivedGeneratedArtifact(asset, 'step-2', 'parent-1')).toMatchObject({
      id: 'asset-1',
      parentArtifactId: 'parent-1',
      metadata: {
        runtimeKey: 'generated:asset-1',
        derivedFrom: 'parent-1'
      }
    });
  });

  it('builds auto-revision lifecycle snapshots for revising, executing, and second review', () => {
    const baseJob = createBaseJob();
    const finalizedReviewStep: JobStep = {
      id: 'review-1',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'failed',
      endTime: 210,
      error: 'needs revision'
    };
    const revisionStep: JobStep = {
      id: 'revision-1',
      kind: 'revision',
      name: 'revise_prompt',
      status: 'success',
      endTime: 220,
      output: {
        revisedPrompt: 'new prompt'
      }
    };
    const revisedGenerationStep: JobStep = {
      id: 'generate-2',
      kind: 'generation',
      name: 'generate_image',
      status: 'running',
      startTime: 230
    };
    const finalizedRevisedGenerationStep: JobStep = {
      ...revisedGenerationStep,
      status: 'success',
      endTime: 240,
      output: {
        assetId: 'asset-2',
        assetType: 'IMAGE'
      }
    };
    const secondReviewStep: JobStep = {
      id: 'review-2',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'running',
      startTime: 250
    };
    const reviewArtifact: JobArtifact = {
      id: 'review-artifact-1',
      type: 'json',
      origin: 'system',
      role: 'review_note',
      createdAt: 210,
      relatedStepId: 'review-1'
    };
    const revisionArtifact: JobArtifact = {
      id: 'revision-artifact-1',
      type: 'text',
      origin: 'system',
      role: 'review_note',
      createdAt: 220,
      relatedStepId: 'revision-1'
    };
    const revisedGeneratedArtifact: JobArtifact = {
      id: 'asset-2',
      type: 'image',
      origin: 'tool',
      role: 'generated_asset',
      createdAt: 240,
      parentArtifactId: 'generated-1',
      relatedStepId: 'generate-2'
    };

    const revisingJob = buildAutoRevisionSnapshot(baseJob, {
      revisionStep,
      finalizedReviewStep,
      reviewArtifact,
      revisionArtifact,
      now: 225
    });
    expect(revisingJob).toMatchObject({
      status: 'revising',
      currentStepId: 'revision-1',
      lastError: undefined,
      updatedAt: 225,
      steps: [baseJob.steps[0], finalizedReviewStep, revisionStep],
      artifacts: [...baseJob.artifacts, reviewArtifact, revisionArtifact]
    });

    const executingJob = buildAutoRevisionExecutionSnapshot(baseJob, {
      stepsAfterRevision: revisingJob.steps,
      revisedGenerationStep,
      artifacts: revisingJob.artifacts,
      now: 230
    });
    expect(executingJob).toMatchObject({
      status: 'executing',
      currentStepId: 'generate-2',
      updatedAt: 230,
      steps: [...revisingJob.steps, revisedGenerationStep],
      artifacts: revisingJob.artifacts
    });

    const reviewingJob = buildAutoRevisionReviewSnapshot(baseJob, {
      stepsAfterRevision: revisingJob.steps,
      finalizedRevisedGenerationStep,
      secondReviewStep,
      artifacts: [...revisingJob.artifacts, revisedGeneratedArtifact],
      now: 250
    });
    expect(reviewingJob).toMatchObject({
      status: 'reviewing',
      currentStepId: 'review-2',
      updatedAt: 250,
      steps: [...revisingJob.steps, finalizedRevisedGenerationStep, secondReviewStep],
      artifacts: [...revisingJob.artifacts, revisedGeneratedArtifact]
    });
  });

  it('builds blocked and completed primary/revised review terminal snapshots', () => {
    const baseJob = createBaseJob();
    const finalizedReviewStep: JobStep = {
      id: 'review-1',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'failed',
      endTime: 210,
      error: 'needs refinement'
    };
    const generatedArtifact = baseJob.artifacts[0];
    const reviewArtifact: JobArtifact = {
      id: 'review-artifact-1',
      type: 'text',
      origin: 'review',
      role: 'review_note',
      createdAt: 210,
      relatedStepId: 'review-1'
    };

    const blockedPrimaryJob = buildPrimaryReviewRequiresActionSnapshot(baseJob, {
      finalizedReviewStep,
      generatedArtifact,
      reviewArtifact,
      lastError: 'needs refinement',
      requiresAction: {
        type: 'review_output',
        message: 'Continue?'
      },
      now: 220
    });
    expect(blockedPrimaryJob).toMatchObject({
      status: 'requires_action',
      currentStepId: undefined,
      lastError: 'needs refinement',
      requiresAction: {
        type: 'review_output',
        message: 'Continue?'
      },
      updatedAt: 220,
      steps: [baseJob.steps[0], finalizedReviewStep],
      artifacts: [...baseJob.artifacts, generatedArtifact, reviewArtifact]
    });

    const completedPrimaryJob = buildPrimaryReviewCompletedSnapshot(baseJob, {
      finalizedReviewStep,
      generatedArtifact,
      reviewArtifact,
      now: 221
    });
    expect(completedPrimaryJob).toMatchObject({
      status: 'completed',
      currentStepId: undefined,
      updatedAt: 221,
      steps: [baseJob.steps[0], finalizedReviewStep],
      artifacts: [...baseJob.artifacts, generatedArtifact, reviewArtifact]
    });

    const stepsAfterRevision = [baseJob.steps[0], finalizedReviewStep, {
      id: 'revision-1',
      kind: 'revision',
      name: 'revise_generation_prompt',
      status: 'success',
      endTime: 230
    } as JobStep];
    const finalizedRevisedGenerationStep: JobStep = {
      id: 'generate-2',
      kind: 'generation',
      name: 'generate_image',
      status: 'success',
      endTime: 240
    };
    const finalizedSecondReviewStep: JobStep = {
      id: 'review-2',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'failed',
      endTime: 250,
      error: 'still needs work'
    };
    const revisionArtifact: JobArtifact = {
      id: 'revision-artifact-1',
      type: 'text',
      origin: 'system',
      role: 'review_note',
      createdAt: 230,
      relatedStepId: 'revision-1'
    };
    const revisedGeneratedArtifact: JobArtifact = {
      id: 'asset-2',
      type: 'image',
      origin: 'generated',
      role: 'final',
      createdAt: 240,
      relatedStepId: 'generate-2'
    };
    const secondReviewArtifact: JobArtifact = {
      id: 'review-artifact-2',
      type: 'text',
      origin: 'review',
      role: 'review_note',
      createdAt: 250,
      relatedStepId: 'review-2'
    };

    const blockedRevisedJob = buildAutoRevisionRequiresActionSnapshot(baseJob, {
      stepsAfterRevision,
      finalizedRevisedGenerationStep,
      finalizedSecondReviewStep,
      generatedArtifact,
      reviewArtifact,
      revisionArtifact,
      revisedGeneratedArtifact,
      secondReviewArtifact,
      lastError: 'still needs work',
      requiresAction: {
        type: 'refine_prompt',
        message: 'Continue refining?'
      },
      now: 260
    });
    expect(blockedRevisedJob).toMatchObject({
      status: 'requires_action',
      currentStepId: undefined,
      lastError: 'still needs work',
      requiresAction: {
        type: 'refine_prompt',
        message: 'Continue refining?'
      },
      updatedAt: 260,
      steps: [...stepsAfterRevision, finalizedRevisedGenerationStep, finalizedSecondReviewStep],
      artifacts: [...baseJob.artifacts, generatedArtifact, reviewArtifact, revisionArtifact, revisedGeneratedArtifact, secondReviewArtifact]
    });

    const completedRevisedJob = buildAutoRevisionCompletedSnapshot(baseJob, {
      stepsAfterRevision,
      finalizedRevisedGenerationStep,
      finalizedSecondReviewStep,
      generatedArtifact,
      reviewArtifact,
      revisionArtifact,
      revisedGeneratedArtifact,
      secondReviewArtifact,
      now: 261
    });
    expect(completedRevisedJob).toMatchObject({
      status: 'completed',
      currentStepId: undefined,
      updatedAt: 261,
      steps: [...stepsAfterRevision, finalizedRevisedGenerationStep, finalizedSecondReviewStep],
      artifacts: [...baseJob.artifacts, generatedArtifact, reviewArtifact, revisionArtifact, revisedGeneratedArtifact, secondReviewArtifact]
    });
  });

  it('prepares primary review resolution for requires-action and completed outcomes', () => {
    const baseJob = createBaseJob();
    const finalizedReviewStep: JobStep = {
      id: 'review-1',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'failed',
      endTime: 250,
      error: 'needs more contrast'
    };
    const generatedArtifact: JobArtifact = {
      id: 'asset-1',
      type: 'image',
      origin: 'generated',
      role: 'final',
      createdAt: 240,
      relatedStepId: 'generate-1'
    };
    const reviewArtifact: JobArtifact = {
      id: 'review-artifact-1',
      type: 'text',
      origin: 'review',
      role: 'review_note',
      createdAt: 250,
      relatedStepId: 'review-1'
    };

    const blocked = preparePrimaryReviewResolution({
      job: baseJob,
      finalizedReviewStep,
      generatedArtifact,
      reviewArtifact,
      review: {
        decision: 'requires_action',
        summary: 'needs more contrast',
        warnings: ['flat contrast']
      },
      prompt: 'cinematic poster',
      now: 260
    });
    expect(blocked.resolution).toBe('requires_action');
    expect(blocked.resolvedJob).toMatchObject({
      status: 'requires_action',
      lastError: 'needs more contrast'
    });
    expect(blocked.resolvedJob.requiresAction).toMatchObject({
      type: 'review_output'
    });

    const completed = preparePrimaryReviewResolution({
      job: baseJob,
      finalizedReviewStep: {
        ...finalizedReviewStep,
        status: 'success',
        error: undefined
      },
      generatedArtifact,
      reviewArtifact,
      review: {
        decision: 'accept',
        summary: 'looks good',
        warnings: []
      },
      prompt: 'cinematic poster',
      now: 261
    });
    expect(completed.resolution).toBe('completed');
    expect(completed.resolvedJob).toMatchObject({
      status: 'completed',
      currentStepId: undefined,
      updatedAt: 261
    });
  });

  it('prepares auto-revision resolution for blocked and completed outcomes', () => {
    const baseJob = createBaseJob();
    const stepsAfterRevision = [baseJob.steps[0], {
      id: 'review-1',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'failed',
      endTime: 210
    } as JobStep, {
      id: 'revision-1',
      kind: 'revision',
      name: 'revise_generation_prompt',
      status: 'success',
      endTime: 230
    } as JobStep];
    const finalizedRevisedGenerationStep: JobStep = {
      id: 'generate-2',
      kind: 'generation',
      name: 'generate_image',
      status: 'success',
      endTime: 240
    };
    const finalizedSecondReviewStep: JobStep = {
      id: 'review-2',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'failed',
      endTime: 250,
      error: 'still needs work'
    };
    const generatedArtifact = baseJob.artifacts[0];
    const reviewArtifact: JobArtifact = {
      id: 'review-artifact-1',
      type: 'text',
      origin: 'review',
      role: 'review_note',
      createdAt: 210,
      relatedStepId: 'review-1'
    };
    const revisionArtifact: JobArtifact = {
      id: 'revision-artifact-1',
      type: 'text',
      origin: 'system',
      role: 'review_note',
      createdAt: 230,
      relatedStepId: 'revision-1'
    };
    const revisedGeneratedArtifact: JobArtifact = {
      id: 'asset-2',
      type: 'image',
      origin: 'generated',
      role: 'final',
      createdAt: 240,
      relatedStepId: 'generate-2'
    };
    const secondReviewArtifact: JobArtifact = {
      id: 'review-artifact-2',
      type: 'text',
      origin: 'review',
      role: 'review_note',
      createdAt: 250,
      relatedStepId: 'review-2'
    };

    const blocked = prepareAutoRevisionResolution({
      job: baseJob,
      stepsAfterRevision,
      finalizedRevisedGenerationStep,
      finalizedSecondReviewStep,
      generatedArtifact,
      reviewArtifact,
      revisionArtifact,
      revisedGeneratedArtifact,
      secondReviewArtifact,
      secondReview: {
        decision: 'requires_action',
        summary: 'still needs work',
        warnings: ['subject mismatch']
      },
      revisedPrompt: 'improve subject',
      revisedAssetId: 'asset-2',
      revisedToolResultRequiresAction: undefined,
      now: 260
    });
    expect(blocked.resolution).toBe('requires_action');
    expect(blocked.resolvedJob).toMatchObject({
      status: 'requires_action',
      lastError: 'still needs work'
    });

    const completed = prepareAutoRevisionResolution({
      job: baseJob,
      stepsAfterRevision,
      finalizedRevisedGenerationStep,
      finalizedSecondReviewStep: {
        ...finalizedSecondReviewStep,
        status: 'success',
        error: undefined
      },
      generatedArtifact,
      reviewArtifact,
      revisionArtifact,
      revisedGeneratedArtifact,
      secondReviewArtifact,
      secondReview: {
        decision: 'accept',
        summary: 'looks good',
        warnings: []
      },
      revisedPrompt: 'improve subject',
      revisedAssetId: 'asset-2',
      revisedToolResultRequiresAction: undefined,
      now: 261
    });
    expect(completed.resolution).toBe('completed');
    expect(completed.resolvedJob).toMatchObject({
      status: 'completed',
      currentStepId: undefined,
      updatedAt: 261
    });
  });

  it('builds cancelled, visible-asset recovery, and failed generation snapshots', () => {
    const baseJob = {
      ...createBaseJob(),
      status: 'executing' as const,
      currentStepId: 'generate-1',
      steps: [{
        ...createBaseJob().steps[0],
        status: 'running' as const,
        startTime: 150
      }]
    };

    const cancelledJob = buildCancelledGenerationSnapshot(baseJob, {
      stepId: 'generate-1',
      now: 300,
      reason: 'Cancelled by user'
    });
    expect(cancelledJob).toMatchObject({
      status: 'cancelled',
      currentStepId: undefined,
      lastError: 'Cancelled by user',
      updatedAt: 300,
      steps: [{
        id: 'generate-1',
        status: 'cancelled',
        startTime: 150,
        endTime: 300,
        error: 'Cancelled by user'
      }]
    });

    const recoveredJob = buildVisibleAssetRecoverySnapshot(baseJob, {
      now: 301,
      lastError: 'review timeout'
    });
    expect(recoveredJob).toMatchObject({
      status: 'completed',
      currentStepId: undefined,
      lastError: 'review timeout',
      updatedAt: 301
    });

    const failedJob = buildFailedGenerationSnapshot(baseJob, {
      stepId: 'generate-1',
      error: 'network error',
      now: 302
    });
    expect(failedJob).toMatchObject({
      status: 'failed',
      currentStepId: undefined,
      lastError: 'network error',
      updatedAt: 302,
      steps: [{
        id: 'generate-1',
        status: 'failed',
        startTime: 150,
        endTime: 302,
        error: 'network error'
      }]
    });
  });

  it('prepares terminal generation handoffs for cancelled, recovered, and failed runs', () => {
    const baseJob = {
      ...createBaseJob(),
      status: 'executing' as const,
      currentStepId: 'generate-1',
      steps: [{
        ...createBaseJob().steps[0],
        status: 'running' as const,
        startTime: 170
      }]
    };

    const cancelled = prepareCancelledGeneration({
      job: baseJob,
      stepId: 'generate-1',
      taskId: 'task-1',
      toolName: 'generate_image',
      reason: 'Cancelled by user',
      now: 300
    });
    expect(cancelled.cancelledJob).toMatchObject({
      status: 'cancelled',
      lastError: 'Cancelled by user'
    });
    expect(cancelled.toolResult).toMatchObject({
      toolName: 'generate_image',
      status: 'error',
      error: 'Cancelled by user',
      retryable: false,
      metadata: {
        taskId: 'task-1',
        lifecycleStatus: 'cancelled'
      }
    });

    const recovered = prepareVisibleAssetRecovery({
      job: baseJob,
      stepId: 'generate-1',
      taskId: 'task-1',
      toolName: 'generate_image',
      assetId: 'asset-1',
      error: 'review timeout',
      now: 301
    });
    expect(recovered.recoveredJob).toMatchObject({
      status: 'completed',
      lastError: 'review timeout'
    });
    expect(recovered.toolResult).toMatchObject({
      status: 'success',
      artifactIds: ['asset-1'],
      metadata: {
        taskId: 'task-1',
        assetId: 'asset-1',
        lifecycleStatus: 'completed',
        reviewError: 'review timeout'
      }
    });

    const failed = prepareFailedGeneration({
      job: baseJob,
      stepId: 'generate-1',
      taskId: 'task-1',
      toolName: 'generate_video',
      error: 'quota exceeded',
      retryable: true,
      now: 302
    });
    expect(failed.failedJob).toMatchObject({
      status: 'failed',
      lastError: 'quota exceeded'
    });
    expect(failed.toolResult).toMatchObject({
      toolName: 'generate_video',
      status: 'error',
      error: 'quota exceeded',
      retryable: true,
      metadata: {
        taskId: 'task-1',
        lifecycleStatus: 'failed'
      }
    });
  });

  it('builds running generation and review start snapshots', () => {
    const baseJob = createBaseJob();
    const runningJob = buildGenerationExecutionSnapshot(baseJob, {
      stepId: 'generate-1',
      now: 180
    });

    expect(runningJob).toMatchObject({
      status: 'executing',
      currentStepId: 'generate-1',
      updatedAt: 180,
      steps: [{
        id: 'generate-1',
        status: 'running',
        startTime: 180
      }]
    });

    const toolResult = {
      jobId: 'job-1',
      stepId: 'generate-1',
      toolName: 'generate_image',
      status: 'success' as const,
      artifactIds: ['asset-1']
    };
    const reviewStep = createRunningReviewStep('review-1', toolResult, 200);
    expect(reviewStep).toMatchObject({
      id: 'review-1',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'running',
      startTime: 200,
      input: {
        toolName: 'generate_image',
        artifactIds: ['asset-1'],
        jobId: 'job-1'
      }
    });

    const generatedArtifact: JobArtifact = {
      id: 'asset-1',
      type: 'image',
      origin: 'generated',
      role: 'final',
      createdAt: 190,
      relatedStepId: 'generate-1'
    };
    const reviewingJob = buildPrimaryReviewStartSnapshot(baseJob, {
      reviewStep,
      generatedArtifact,
      now: 200
    });

    expect(reviewingJob).toMatchObject({
      status: 'reviewing',
      currentStepId: 'review-1',
      updatedAt: 200,
      artifacts: [...baseJob.artifacts, generatedArtifact]
    });
    expect(reviewingJob.steps.at(-1)).toEqual(reviewStep);
  });

  it('prepares generation execution and operation-update handoffs', () => {
    const baseJob = createBaseJob();
    const running = prepareGenerationExecution({
      job: baseJob,
      stepId: 'generate-1',
      taskId: 'task-1',
      now: 180
    });

    expect(running.runningJob).toMatchObject({
      status: 'executing',
      currentStepId: 'generate-1',
      updatedAt: 180
    });
    expect(running.assetPatch).toEqual({ status: 'GENERATING' });
    expect(running.assetViewPatch).toEqual({ status: 'GENERATING' });

    const operation = prepareGenerationOperationUpdate({
      job: running.runningJob,
      stepId: 'generate-1',
      taskId: 'task-1',
      operationName: 'rendering frames',
      now: 190
    });

    expect(operation.jobWithOperation).toMatchObject({
      updatedAt: 190,
      steps: [{
        id: 'generate-1',
        output: {
          operationName: 'rendering frames'
        }
      }]
    });
    expect(operation.assetPatch).toEqual({ operationName: 'rendering frames' });
  });

  it('prepares primary review handoff from a generated asset and tool result', () => {
    const asset = createPendingGenerationAsset({
      taskId: 'asset-queued',
      projectId: 'project-1',
      mode: AppMode.IMAGE,
      params: createParams(),
      jobId: 'job-1',
      now: 100
    });
    const toolResult = {
      jobId: 'job-1',
      stepId: 'generate-1',
      toolName: 'generate_image',
      status: 'success' as const,
      artifactIds: ['asset-queued']
    };

    const handoff = preparePrimaryReview({
      job: createBaseJob(),
      asset,
      generationStepId: 'generate-1',
      reviewStepId: 'review-1',
      toolResult,
      startedAt: 200
    });

    expect(handoff.generatedArtifact).toMatchObject({
      id: 'asset-queued',
      relatedStepId: 'generate-1'
    });
    expect(handoff.reviewStep).toMatchObject({
      id: 'review-1',
      kind: 'review',
      status: 'running',
      startTime: 200
    });
    expect(handoff.reviewingJob).toMatchObject({
      status: 'reviewing',
      currentStepId: 'review-1',
      updatedAt: 200
    });
  });

  it('builds generation operation and completion snapshots', () => {
    const baseJob = {
      ...createBaseJob(),
      status: 'executing' as const,
      currentStepId: 'generate-1',
      steps: [{
        ...createBaseJob().steps[0],
        status: 'running' as const,
        startTime: 170
      }]
    };

    const jobWithOperation = buildGenerationOperationSnapshot(baseJob, {
      stepId: 'generate-1',
      operationName: 'rendering frames',
      now: 190
    });
    expect(jobWithOperation).toMatchObject({
      updatedAt: 190,
      steps: [{
        id: 'generate-1',
        status: 'running',
        startTime: 170,
        output: {
          operationName: 'rendering frames'
        }
      }]
    });

    const imageAsset = createPendingGenerationAsset({
      taskId: 'asset-1',
      projectId: 'project-1',
      mode: AppMode.IMAGE,
      params: createParams(),
      jobId: 'job-1',
      now: 200
    });
    const completedImageJob = buildGenerationCompletionSnapshot(jobWithOperation, {
      stepId: 'generate-1',
      asset: {
        ...imageAsset,
        status: 'COMPLETED'
      },
      now: 210
    });
    expect(completedImageJob).toMatchObject({
      updatedAt: 210,
      steps: [{
        id: 'generate-1',
        status: 'success',
        startTime: 170,
        endTime: 210,
        output: {
          operationName: 'rendering frames',
          assetId: 'asset-1',
          assetType: 'IMAGE'
        }
      }]
    });

    const videoAsset = {
      ...imageAsset,
      id: 'asset-2',
      type: 'VIDEO' as const
    };
    const completedVideoJob = buildGenerationCompletionSnapshot(baseJob, {
      stepId: 'generate-1',
      asset: videoAsset,
      now: 211,
      extraOutput: {
        videoUri: 'gs://video.mp4'
      }
    });
    expect(completedVideoJob).toMatchObject({
      updatedAt: 211,
      steps: [{
        id: 'generate-1',
        status: 'success',
        endTime: 211,
        output: {
          assetId: 'asset-2',
          assetType: 'VIDEO',
          videoUri: 'gs://video.mp4'
        }
      }]
    });
  });

  it('prepares completed generation handoff for image and video results', () => {
    const baseJob = {
      ...createBaseJob(),
      status: 'executing' as const,
      currentStepId: 'generate-1',
      steps: [{
        ...createBaseJob().steps[0],
        status: 'running' as const,
        startTime: 170
      }]
    };
    const imageAsset = {
      ...createPendingGenerationAsset({
        taskId: 'asset-1',
        projectId: 'project-1',
        mode: AppMode.IMAGE,
        params: createParams(),
        jobId: 'job-1',
        now: 200
      }),
      status: 'COMPLETED' as const
    };

    const imageResult = prepareCompletedGeneration({
      job: baseJob,
      stepId: 'generate-1',
      taskId: 'task-1',
      toolName: 'generate_image',
      asset: imageAsset,
      now: 210
    });

    expect(imageResult.completedJob).toMatchObject({
      updatedAt: 210,
      steps: [{
        id: 'generate-1',
        status: 'success',
        output: {
          assetId: 'asset-1',
          assetType: 'IMAGE'
        }
      }]
    });
    expect(imageResult.toolResult).toMatchObject({
      jobId: 'job-1',
      stepId: 'generate-1',
      toolName: 'generate_image',
      status: 'success',
      artifactIds: ['asset-1'],
      metadata: {
        assetId: 'asset-1',
        taskId: 'task-1'
      }
    });

    const videoAsset = {
      ...createPendingGenerationAsset({
        taskId: 'asset-2',
        projectId: 'project-1',
        mode: AppMode.VIDEO,
        params: createParams(),
        jobId: 'job-1',
        now: 200
      }),
      status: 'COMPLETED' as const,
      videoUri: 'gs://video.mp4'
    };

    const videoResult = prepareCompletedGeneration({
      job: baseJob,
      stepId: 'generate-1',
      taskId: 'task-2',
      toolName: 'generate_video',
      asset: videoAsset,
      now: 220,
      extraOutput: {
        videoUri: 'gs://video.mp4'
      },
      extraMetadata: {
        videoUri: 'gs://video.mp4'
      },
      message: 'Video generation completed'
    });

    expect(videoResult.completedJob.steps[0]).toMatchObject({
      output: {
        assetId: 'asset-2',
        assetType: 'VIDEO',
        videoUri: 'gs://video.mp4'
      }
    });
    expect(videoResult.toolResult).toMatchObject({
      toolName: 'generate_video',
      metadata: {
        assetId: 'asset-2',
        taskId: 'task-2',
        videoUri: 'gs://video.mp4'
      }
    });
  });

  it('builds generated/review artifacts and running revision/generation steps', () => {
    const asset = createPendingGenerationAsset({
      taskId: 'asset-1',
      projectId: 'project-1',
      mode: AppMode.IMAGE,
      params: createParams(),
      jobId: 'job-1',
      now: 300
    });

    expect(buildGeneratedAssetArtifact({
      asset,
      stepId: 'generate-1'
    })).toMatchObject({
      id: 'asset-1',
      role: 'final',
      relatedStepId: 'generate-1',
      metadata: {
        runtimeKey: 'generated:asset-1'
      }
    });

    expect(buildReviewNoteArtifact({
      artifactId: 'review-1',
      stepId: 'review-step',
      review: {
        decision: 'requires_action',
        summary: 'needs work',
        warnings: ['flat']
      }
    })).toMatchObject({
      id: 'review-1',
      role: 'review_note',
      relatedStepId: 'review-step',
      metadata: {
        decision: 'requires_action',
        summary: 'needs work',
        warnings: ['flat']
      }
    });

    const runningRevisionStep = createRunningRevisionStep({
      stepId: 'revision-1',
      review: {
        decision: 'auto_revise',
        summary: 'improve subject',
        warnings: [],
        revisedPrompt: 'better prompt'
      },
      previousPrompt: 'base prompt',
      startedAt: 310
    });
    expect(runningRevisionStep).toMatchObject({
      id: 'revision-1',
      kind: 'revision',
      name: 'revise_generation_prompt',
      status: 'running',
      startTime: 310,
      input: {
        previousPrompt: 'base prompt',
        revisedPrompt: 'better prompt'
      }
    });

    const runningGenerationStep = createRunningGenerationStep({
      stepId: 'generate-2',
      mode: AppMode.IMAGE,
      params: createParams(),
      toolCall: {
        toolName: 'generate_image',
        args: {
          prompt: 'cinematic poster'
        }
      },
      startedAt: 311
    });
    expect(runningGenerationStep).toMatchObject({
      id: 'generate-2',
      kind: 'generation',
      name: 'generate_image',
      status: 'running',
      startTime: 311,
      input: {
        prompt: 'cinematic poster'
      }
    });
  });

  it('finalizes review outcomes into artifact, step, and reviewed tool result', () => {
    const reviewStep = createRunningReviewStep('review-1', {
      jobId: 'job-1',
      stepId: 'generate-1',
      toolName: 'generate_image',
      status: 'success',
      artifactIds: ['asset-1']
    }, 400);

    const outcome = finalizeReviewOutcome({
      artifactId: 'review-artifact-1',
      reviewStep,
      review: {
        decision: 'requires_action',
        summary: 'needs refinement',
        warnings: ['flat lighting']
      },
      toolResult: {
        jobId: 'job-1',
        stepId: 'generate-1',
        toolName: 'generate_image',
        status: 'success',
        artifactIds: ['asset-1']
      },
      endedAt: 450,
      toolResultOptions: {
        nonAcceptStatus: 'requires_action',
        requiresAction: {
          type: 'review_output',
          message: 'Continue?'
        }
      }
    });

    expect(outcome.reviewArtifact).toMatchObject({
      id: 'review-artifact-1',
      role: 'review_note',
      relatedStepId: 'review-1',
      metadata: {
        decision: 'requires_action',
        summary: 'needs refinement'
      }
    });
    expect(outcome.finalizedReviewStep).toMatchObject({
      id: 'review-1',
      status: 'failed',
      endTime: 450,
      error: 'needs refinement'
    });
    expect(outcome.reviewedToolResult).toMatchObject({
      jobId: 'job-1',
      stepId: 'generate-1',
      toolName: 'generate_image',
      status: 'requires_action',
      error: 'needs refinement',
      requiresAction: {
        type: 'review_output',
        message: 'Continue?'
      },
      metadata: {
        review: {
          decision: 'requires_action',
          summary: 'needs refinement',
          stepId: 'review-1'
        }
      }
    });
  });

  it('builds revised-generation handoff into second review', () => {
    const baseJob = createBaseJob();
    const stepsAfterRevision: JobStep[] = [
      baseJob.steps[0],
      {
        id: 'revision-1',
        kind: 'revision',
        name: 'revise_generation_prompt',
        status: 'success',
        endTime: 500
      }
    ];
    const executingRevisionJob: AgentJob = {
      ...baseJob,
      status: 'executing',
      currentStepId: 'generate-2',
      updatedAt: 501,
      steps: [
        ...stepsAfterRevision,
        {
          id: 'generate-2',
          kind: 'generation',
          name: 'generate_image',
          status: 'running',
          startTime: 501
        }
      ],
      artifacts: [...baseJob.artifacts, {
        id: 'revision-artifact-1',
        type: 'text',
        origin: 'system',
        role: 'review_note',
        createdAt: 500,
        relatedStepId: 'revision-1'
      }]
    };
    const revisedAsset: AssetItem = {
      ...createPendingGenerationAsset({
        taskId: 'asset-2',
        projectId: 'project-1',
        mode: AppMode.IMAGE,
        params: createParams(),
        jobId: 'job-1',
        now: 510
      }),
      status: 'COMPLETED'
    };

    const handoff = buildAutoRevisionReviewHandoff({
      executingRevisionJob,
      stepsAfterRevision,
      revisedGenerationStep: executingRevisionJob.steps.at(-1)!,
      revisedGenerationStepId: 'generate-2',
      revisedAsset,
      parentArtifactId: 'generated-1',
      secondReviewStepId: 'review-2',
      toolResult: {
        jobId: 'job-1',
        stepId: 'generate-1',
        toolName: 'generate_image',
        status: 'success',
        artifactIds: ['asset-1']
      },
      now: 520
    });

    expect(handoff.finalizedRevisedGenerationStep).toMatchObject({
      id: 'generate-2',
      status: 'success',
      endTime: 520,
      output: {
        assetId: 'asset-2',
        assetType: 'IMAGE'
      }
    });
    expect(handoff.revisedGeneratedArtifact).toMatchObject({
      id: 'asset-2',
      parentArtifactId: 'generated-1',
      metadata: {
        derivedFrom: 'generated-1'
      }
    });
    expect(handoff.secondReviewStep).toMatchObject({
      id: 'review-2',
      status: 'running',
      input: {
        artifactIds: ['asset-2']
      }
    });
    expect(handoff.reviewingRevisionJob).toMatchObject({
      status: 'reviewing',
      currentStepId: 'review-2',
      updatedAt: 520,
      steps: [...stepsAfterRevision, handoff.finalizedRevisedGenerationStep, handoff.secondReviewStep],
      artifacts: [...executingRevisionJob.artifacts, handoff.revisedGeneratedArtifact]
    });
  });

  it('builds auto-revision execution handoff from review result to revised generation start', () => {
    const baseJob = createBaseJob();
    const finalizedReviewStep: JobStep = {
      id: 'review-1',
      kind: 'review',
      name: 'review_generated_asset',
      status: 'failed',
      endTime: 410,
      error: 'needs revision'
    };
    const reviewArtifact: JobArtifact = {
      id: 'review-artifact-1',
      type: 'text',
      origin: 'review',
      role: 'review_note',
      createdAt: 410,
      relatedStepId: 'review-1'
    };

    const handoff = buildAutoRevisionExecutionHandoff({
      job: baseJob,
      review: {
        decision: 'auto_revise',
        summary: 'improve subject fidelity',
        warnings: [],
        revisedPrompt: 'better subject fidelity',
        revisionReason: 'subject weak'
      },
      currentMode: AppMode.IMAGE,
      originalPrompt: 'base prompt',
      genParams: createParams(),
      toolCall: {
        toolName: 'generate_image',
        args: {
          prompt: 'cinematic poster'
        }
      },
      finalizedReviewStep,
      reviewArtifact,
      revisionStepId: 'revision-1',
      revisionArtifactId: 'revision-artifact-1',
      revisedGenerationStepId: 'generate-2',
      revisionStartedAt: 420,
      now: 430
    });

    expect(handoff.revisionArtifact).toMatchObject({
      id: 'revision-artifact-1',
      relatedStepId: 'revision-1',
      metadata: {
        previousPrompt: 'base prompt',
        revisedPrompt: 'better subject fidelity',
        revisionReason: 'subject weak'
      }
    });
    expect(handoff.completedRevisionStep).toMatchObject({
      id: 'revision-1',
      status: 'success',
      startTime: 420,
      endTime: 430,
      output: {
        revisedPrompt: 'better subject fidelity',
        revisionReason: 'subject weak'
      }
    });
    expect(handoff.revisingJob).toMatchObject({
      status: 'revising',
      currentStepId: 'revision-1',
      updatedAt: 430
    });
    expect(handoff.revisedPrompt).toBe('better subject fidelity');
    expect(handoff.revisedParams.prompt).toBe('better subject fidelity');
    expect(handoff.revisedGenerationStep).toMatchObject({
      id: 'generate-2',
      status: 'running',
      startTime: 430,
      input: {
        prompt: 'better subject fidelity'
      }
    });
    expect(handoff.executingRevisionJob).toMatchObject({
      status: 'executing',
      currentStepId: 'generate-2',
      updatedAt: 430,
      steps: [...handoff.stepsAfterRevision, handoff.revisedGenerationStep],
      artifacts: handoff.revisingJob.artifacts
    });
  });

  it('builds default requires-action payloads and revised tool result metadata', () => {
    const reviewPlan = buildOptimizationPlan({
      summary: 'Keep current composition and improve subject fidelity',
      adjust: ['subject fidelity']
    });
    const payload = buildRequiresActionPayload('base prompt', {
      summary: 'needs refinement',
      warnings: ['flat lighting'],
      revisedPrompt: 'better prompt',
      reviewPlan
    }, {
      message: {
        zh: '继续优化',
        en: 'Continue refining'
      }
    }, {
      latestAssetId: 'asset-2'
    });

    expect(payload).toMatchObject({
      prompt: 'base prompt',
      revisedPrompt: 'better prompt',
      warnings: ['flat lighting'],
      reviewPlan,
      messageI18n: {
        zh: '继续优化',
        en: 'Continue refining'
      },
      latestAssetId: 'asset-2',
      recommendedAction: 'continue_optimization'
    });

    const primaryAction = buildDefaultPrimaryReviewRequiresAction({
      prompt: 'base prompt',
      review: {
        summary: 'needs more focus',
        warnings: ['soft details'],
        revisedPrompt: 'sharper subject'
      }
    });
    expect(primaryAction).toMatchObject({
      type: 'review_output',
      message: 'I already know the next refinement I would make. If you want, I can continue from here.'
    });
    expect((primaryAction.payload as any).reviewPlan.summary).toContain('focused refinement pass');

    const refineAction = buildDefaultRefinePromptRequiresAction({
      prompt: 'better prompt',
      latestAssetId: 'asset-2',
      review: {
        summary: 'subject still weak',
        warnings: ['identity drift'],
        revisedPrompt: 'better prompt'
      }
    });
    expect(refineAction).toMatchObject({
      type: 'refine_prompt',
      message: 'I already know how I would improve this version next. If you want, I can continue from here.'
    });
    expect((refineAction.payload as any).latestAssetId).toBe('asset-2');

    const revisedToolResult = buildRevisedToolResult({
      baseToolResult: {
        jobId: 'job-1',
        stepId: 'generate-1',
        toolName: 'generate_image',
        status: 'requires_action',
        metadata: {
          review: {
            decision: 'requires_action',
            summary: 'subject still weak',
            stepId: 'review-2'
          }
        }
      },
      revisedPrompt: 'better prompt',
      revisionStepId: 'revision-1',
      revisionReason: 'subject weak',
      secondReview: {
        decision: 'requires_action',
        summary: 'subject still weak',
        warnings: ['identity drift'],
        issues: [{ type: 'other', message: 'identity drift' }],
        quality: {
          promptAlignment: 0.5,
          visualCoherence: 0.6,
          creativity: 0.7,
          issueSeverity: 'medium'
        },
        reviewTrace: {
          rawDecision: 'requires_action',
          finalDecision: 'requires_action',
          summary: 'subject still weak',
          preserve: [],
          adjust: ['subject fidelity']
        }
      },
      secondReviewStepId: 'review-2'
    });
    expect(revisedToolResult).toMatchObject({
      metadata: {
        revisedPrompt: 'better prompt',
        revision: {
          stepId: 'revision-1',
          reason: 'subject weak'
        },
        review: {
          decision: 'requires_action',
          summary: 'subject still weak',
          stepId: 'review-2'
        }
      }
    });
  });
});
