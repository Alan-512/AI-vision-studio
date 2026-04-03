import { describe, it, expect } from 'vitest';
import { AgentAction, AgentJob, AgentToolResult, AppMode, AssetItem, AspectRatio, GenerationParams, ImageModel, ImageResolution, ImageStyle, JobArtifact, SearchProgress, VideoDuration, VideoModel, VideoResolution, VideoStyle } from '../types';
import {
    artifactToSmartAsset,
    buildGeneratedArtifact,
    buildReviewArtifact,
    buildArtifactReferenceCandidates,
    buildReferenceArtifacts,
    buildSearchArtifacts,
    cancelAgentJob,
    completeAgentJob,
    createGenerationStep,
    createReviewStep,
    createRevisionStep,
    extractSearchContextFromProgress,
    failAgentJob,
    mergeRuntimeArtifacts,
    mergeAgentJobStepOutput,
    requireAgentJobAction,
    selectReferenceRecords,
    succeedAgentJobStep,
    startAgentJobExecution,
    startAgentJobReview
} from '../services/agentRuntime';

describe('AgentRuntime helpers', () => {
    const createBaseJob = (): AgentJob => ({
        id: 'job-1',
        projectId: 'project-1',
        type: 'IMAGE_GENERATION',
        status: 'queued',
        createdAt: 100,
        updatedAt: 100,
        source: 'chat',
        currentStepId: undefined,
        steps: [{
            id: 'step-1',
            kind: 'generation',
            name: 'generate_image',
            status: 'pending',
            input: {
                prompt: 'poster'
            }
        }],
        artifacts: []
    });

    it('should build reference artifacts with stable runtime metadata', () => {
        const artifacts = buildReferenceArtifacts([
            {
                asset: {
                    id: 'user-123-0',
                    mimeType: 'image/png',
                    data: 'abc123'
                },
                sourceRole: 'user',
                messageTimestamp: 123
            }
        ]);

        expect(artifacts).toHaveLength(1);
        expect(artifacts[0].role).toBe('reference');
        expect(artifacts[0].metadata?.sourceImageId).toBe('user-123-0');
        expect(artifacts[0].metadata?.runtimeKey).toBe('reference:user-123-0');
    });

    it('should extract structured search context from completed search progress', () => {
        const progress: SearchProgress = {
            status: 'complete',
            queries: ['minimal perfume poster'],
            results: [{ label: 'Style', value: 'matte white bottle on stone pedestal' }],
            sources: [{ title: 'Reference', url: 'https://example.com/ref' }]
        };

        const context = extractSearchContextFromProgress(progress);
        expect(context?.queries).toEqual(['minimal perfume poster']);
        expect(context?.facts).toEqual([{ item: 'Style: matte white bottle on stone pedestal', source: undefined }]);
        expect(context?.sources).toEqual([{ title: 'Reference', url: 'https://example.com/ref' }]);
    });

    it('should build and dedupe runtime artifacts by runtime key', () => {
        const searchArtifacts = buildSearchArtifacts({
            queries: ['query'],
            facts: [{ item: 'fact' }],
            sources: [{ title: 'Doc', url: 'https://example.com' }]
        });

        const merged = mergeRuntimeArtifacts(searchArtifacts, [...searchArtifacts]);
        expect(searchArtifacts).toHaveLength(1);
        expect(merged).toHaveLength(1);
        expect(merged[0].role).toBe('retrieved_context');
    });

    it('should recover smart assets and lookup ids from persisted job artifacts', () => {
        const generatedArtifact: JobArtifact = {
            id: 'asset-1',
            type: 'image',
            origin: 'generated',
            role: 'final',
            base64: 'encoded-data',
            mimeType: 'image/png',
            createdAt: Date.now(),
            metadata: {
                sourceImageId: 'generated-999-0',
                runtimeKey: 'generated:asset-1'
            }
        };
        const referenceArtifact: JobArtifact = {
            id: 'ref-1',
            type: 'image',
            origin: 'user_upload',
            role: 'reference',
            base64: 'ref-data',
            mimeType: 'image/jpeg',
            createdAt: Date.now(),
            relatedMessageTimestamp: 456,
            metadata: {
                sourceImageId: 'user-456-0',
                runtimeKey: 'reference:user-456-0',
                sourceRole: 'user'
            }
        };
        const jobs: AgentJob[] = [{
            id: 'job-1',
            projectId: 'project-1',
            type: 'IMAGE_GENERATION',
            status: 'completed',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: 'chat',
            steps: [],
            artifacts: [generatedArtifact, referenceArtifact]
        }];

        const candidates = buildArtifactReferenceCandidates(jobs);
        const candidateIds = candidates.flatMap(candidate => Array.from(candidate.candidateIds));

        expect(candidateIds).toContain('asset-1');
        expect(candidateIds).toContain('generated:asset-1');
        expect(candidateIds).toContain('generated-999-0');
        expect(candidateIds).toContain('reference:user-456-0');

        const recovered = artifactToSmartAsset(referenceArtifact);
        expect(recovered).toEqual({
            id: 'user-456-0',
            mimeType: 'image/jpeg',
            data: 'ref-data'
        });
    });

    it('should prefer runtime artifact candidates for explicit reference ids', () => {
        const jobs: AgentJob[] = [{
            id: 'job-1',
            projectId: 'project-1',
            type: 'IMAGE_GENERATION',
            status: 'completed',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: 'chat',
            steps: [],
            artifacts: [{
                id: 'artifact-ref',
                type: 'image',
                origin: 'user_upload',
                role: 'reference',
                base64: 'artifact-data',
                mimeType: 'image/png',
                createdAt: Date.now(),
                metadata: {
                    sourceImageId: 'user-123-0',
                    runtimeKey: 'reference:user-123-0',
                    sourceRole: 'user'
                }
            }]
        }];

        const selected = selectReferenceRecords({
            jobs,
            chatHistory: [],
            requestedIds: ['user-123-0'],
            playbookReferenceMode: undefined,
            hasUserUploadedImages: false
        });

        expect(selected).toHaveLength(1);
        expect(selected[0].asset.id).toBe('user-123-0');
        expect(selected[0].asset.data).toBe('artifact-data');
    });

    it('should keep transcript fallback for legacy chat-only projects', () => {
        const selected = selectReferenceRecords({
            jobs: [],
            chatHistory: [{
                role: 'user',
                content: 'use this',
                timestamp: 789,
                images: ['data:image/png;base64,legacy-data']
            }],
            requestedIds: [],
            playbookReferenceMode: undefined,
            hasUserUploadedImages: true
        });

        expect(selected).toHaveLength(1);
        expect(selected[0].asset.id).toBe('user-789-0');
        expect(selected[0].asset.data).toBe('legacy-data');
    });

    it('should use generated artifact fallback for last generated mode without transcript image', () => {
        const jobs: AgentJob[] = [{
            id: 'job-2',
            projectId: 'project-1',
            type: 'IMAGE_GENERATION',
            status: 'completed',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: 'chat',
            steps: [],
            artifacts: [{
                id: 'generated-asset',
                type: 'image',
                origin: 'generated',
                role: 'final',
                base64: 'generated-data',
                mimeType: 'image/png',
                createdAt: Date.now(),
                metadata: {
                    runtimeKey: 'generated:generated-asset'
                }
            }]
        }];

        const selected = selectReferenceRecords({
            jobs,
            chatHistory: [],
            requestedIds: [],
            playbookReferenceMode: 'LAST_GENERATED',
            hasUserUploadedImages: false
        });

        expect(selected).toHaveLength(1);
        expect(selected[0].sourceRole).toBe('model');
        expect(selected[0].asset.data).toBe('generated-data');
    });

    it('should create a generation step from mode, params and tool call', () => {
        const params: GenerationParams = {
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
            useGrounding: true
        };
        const toolCall: AgentAction = {
            toolName: 'generate_image',
            args: {
                prompt: params.prompt
            }
        };

        expect(createGenerationStep('step-1', AppMode.IMAGE, params, toolCall)).toEqual({
            id: 'step-1',
            kind: 'generation',
            name: 'generate_image',
            toolName: 'generate_image',
            status: 'pending',
            input: {
                prompt: 'cinematic poster',
                model: ImageModel.FLASH_3_1,
                aspectRatio: AspectRatio.SQUARE,
                resolution: ImageResolution.RES_1K,
                duration: undefined,
                useGrounding: true,
                toolArgs: {
                    prompt: 'cinematic poster'
                }
            }
        });
    });

    it('should build generated and review artifacts with runtime metadata', () => {
        const asset: AssetItem = {
            id: 'asset-1',
            projectId: 'project-1',
            type: 'IMAGE',
            url: 'data:image/png;base64,abc123',
            prompt: 'poster',
            createdAt: 123,
            status: 'COMPLETED',
            metadata: {
                aspectRatio: AspectRatio.SQUARE,
                model: ImageModel.FLASH_3_1
            }
        };

        const generatedArtifact = buildGeneratedArtifact(asset, 'step-gen');
        expect(generatedArtifact).toMatchObject({
            id: 'asset-1',
            origin: 'generated',
            role: 'final',
            mimeType: 'image/png',
            relatedStepId: 'step-gen',
            metadata: {
                aspectRatio: AspectRatio.SQUARE,
                model: ImageModel.FLASH_3_1,
                runtimeKey: 'generated:asset-1'
            }
        });

        const reviewArtifact = buildReviewArtifact('review-1', 'step-review', {
            decision: 'revise_prompt',
            summary: 'needs more contrast',
            warnings: ['flat lighting'],
            revisedPrompt: 'high contrast cinematic poster'
        });

        expect(reviewArtifact).toMatchObject({
            id: 'review-1',
            type: 'text',
            origin: 'review',
            role: 'review_note',
            relatedStepId: 'step-review',
            metadata: {
                decision: 'revise_prompt',
                summary: 'needs more contrast',
                warnings: ['flat lighting'],
                revisedPrompt: 'high contrast cinematic poster'
            }
        });
    });

    it('should create review and revision steps from tool results and review payloads', () => {
        const toolResult: AgentToolResult = {
            jobId: 'job-1',
            stepId: 'step-gen',
            toolName: 'generate_image',
            status: 'success',
            artifactIds: ['asset-1']
        };

        expect(createReviewStep('step-review', toolResult)).toEqual({
            id: 'step-review',
            kind: 'review',
            name: 'review_generated_asset',
            status: 'pending',
            input: {
                toolName: 'generate_image',
                artifactIds: ['asset-1'],
                jobId: 'job-1'
            }
        });

        expect(createRevisionStep('step-revise', {
            decision: 'revise_prompt',
            summary: 'needs clearer subject',
            warnings: [],
            revisionReason: 'subject unclear',
            revisedPrompt: 'clear subject cinematic poster'
        }, 'old prompt')).toEqual({
            id: 'step-revise',
            kind: 'revision',
            name: 'revise_generation_prompt',
            status: 'pending',
            input: {
                previousPrompt: 'old prompt',
                revisionReason: 'subject unclear',
                revisedPrompt: 'clear subject cinematic poster'
            }
        });
    });

    it('should transition a queued job into executing by starting the active step', () => {
        const startedJob = startAgentJobExecution(createBaseJob(), {
            stepId: 'step-1',
            now: 200
        });

        expect(startedJob).toMatchObject({
            status: 'executing',
            currentStepId: 'step-1',
            updatedAt: 200,
            steps: [{
                id: 'step-1',
                status: 'running',
                startTime: 200
            }]
        });
    });

    it('should merge running step output and finalize a step as success', () => {
        const runningJob = startAgentJobExecution(createBaseJob(), {
            stepId: 'step-1',
            now: 200
        });

        const jobWithOperation = mergeAgentJobStepOutput(runningJob, {
            stepId: 'step-1',
            output: {
                operationName: 'rendering frames'
            },
            now: 250
        });

        expect(jobWithOperation).toMatchObject({
            updatedAt: 250,
            steps: [{
                id: 'step-1',
                status: 'running',
                startTime: 200,
                output: {
                    operationName: 'rendering frames'
                }
            }]
        });

        const completedJob = succeedAgentJobStep(jobWithOperation, {
            stepId: 'step-1',
            output: {
                assetId: 'asset-1',
                assetType: 'IMAGE'
            },
            now: 300
        });

        expect(completedJob).toMatchObject({
            updatedAt: 300,
            steps: [{
                id: 'step-1',
                status: 'success',
                startTime: 200,
                endTime: 300,
                output: {
                    operationName: 'rendering frames',
                    assetId: 'asset-1',
                    assetType: 'IMAGE'
                }
            }]
        });
    });

    it('should transition a job into reviewing by appending review step and generated artifact', () => {
        const reviewStep = {
            ...createReviewStep('step-review', {
                jobId: 'job-1',
                stepId: 'step-1',
                toolName: 'generate_image',
                status: 'success',
                artifactIds: ['asset-1']
            }),
            status: 'running' as const,
            startTime: 300
        };
        const generatedArtifact: JobArtifact = {
            id: 'asset-1',
            type: 'image',
            origin: 'generated',
            role: 'final',
            url: 'data:image/png;base64,abc',
            mimeType: 'image/png',
            createdAt: 250,
            relatedStepId: 'step-1',
            metadata: {
                runtimeKey: 'generated:asset-1'
            }
        };

        const reviewingJob = startAgentJobReview(createBaseJob(), {
            reviewStep,
            generatedArtifact,
            now: 300
        });

        expect(reviewingJob).toMatchObject({
            status: 'reviewing',
            currentStepId: 'step-review',
            updatedAt: 300
        });
        expect(reviewingJob.steps.at(-1)).toEqual(reviewStep);
        expect(reviewingJob.artifacts.at(-1)).toEqual(generatedArtifact);
    });

    it('should build completed and requires_action terminal snapshots', () => {
        const finalizedStep = {
            ...createBaseJob().steps[0],
            status: 'success' as const,
            endTime: 400
        };
        const reviewArtifact: JobArtifact = {
            id: 'review-1',
            type: 'text',
            origin: 'review',
            role: 'review_note',
            createdAt: 401
        };

        const completedJob = completeAgentJob(createBaseJob(), {
            now: 400,
            steps: [finalizedStep],
            artifacts: [reviewArtifact]
        });
        expect(completedJob).toMatchObject({
            status: 'completed',
            currentStepId: undefined,
            lastError: undefined,
            requiresAction: undefined,
            updatedAt: 400
        });

        const blockedJob = requireAgentJobAction(createBaseJob(), {
            now: 401,
            lastError: 'Need refinement',
            requiresAction: {
                type: 'review_output',
                message: 'Continue?'
            },
            steps: [finalizedStep],
            artifacts: [reviewArtifact]
        });
        expect(blockedJob).toMatchObject({
            status: 'requires_action',
            currentStepId: undefined,
            lastError: 'Need refinement',
            requiresAction: {
                type: 'review_output',
                message: 'Continue?'
            },
            updatedAt: 401
        });
    });

    it('should build failed and cancelled snapshots by finalizing the active step', () => {
        const runningJob = startAgentJobExecution(createBaseJob(), {
            stepId: 'step-1',
            now: 200
        });

        const failedJob = failAgentJob(runningJob, {
            stepId: 'step-1',
            error: 'network error',
            now: 500
        });
        expect(failedJob).toMatchObject({
            status: 'failed',
            currentStepId: undefined,
            lastError: 'network error',
            updatedAt: 500,
            steps: [{
                id: 'step-1',
                status: 'failed',
                endTime: 500,
                error: 'network error'
            }]
        });

        const cancelledJob = cancelAgentJob(runningJob, {
            stepId: 'step-1',
            reason: 'Cancelled by user',
            now: 501
        });
        expect(cancelledJob).toMatchObject({
            status: 'cancelled',
            currentStepId: undefined,
            lastError: 'Cancelled by user',
            updatedAt: 501,
            steps: [{
                id: 'step-1',
                status: 'cancelled',
                endTime: 501,
                error: 'Cancelled by user'
            }]
        });
    });
});
