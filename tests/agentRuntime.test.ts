import { describe, it, expect } from 'vitest';
import { AgentJob, JobArtifact, SearchProgress } from '../types';
import {
    artifactToSmartAsset,
    buildArtifactReferenceCandidates,
    buildReferenceArtifacts,
    buildSearchArtifacts,
    extractSearchContextFromProgress,
    mergeRuntimeArtifacts
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
});
