import { describe, it, expect } from 'vitest';
import { AgentJob, JobArtifact, SearchProgress } from '../types';
import {
    artifactToSmartAsset,
    buildArtifactReferenceCandidates,
    buildReferenceArtifacts,
    buildSearchArtifacts,
    extractSearchContextFromProgress,
    mergeRuntimeArtifacts,
    selectReferenceRecords
} from '../services/agentRuntime';

describe('AgentRuntime helpers', () => {
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
});
