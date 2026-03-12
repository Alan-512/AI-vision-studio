import { AgentJob, JobArtifact, SearchProgress, SmartAsset } from '../types';

export type SelectedReferenceRecord = {
  asset: SmartAsset;
  sourceRole: 'user' | 'model';
  messageTimestamp?: number;
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

export const buildArtifactReferenceCandidates = (jobs: AgentJob[]): Array<{ candidateIds: Set<string>; record: SelectedReferenceRecord }> =>
  [...jobs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap(job => job.artifacts)
    .filter(artifact => artifact.role === 'reference' || artifact.origin === 'generated')
    .map(artifact => {
      const asset = artifactToSmartAsset(artifact);
      if (!asset) return null;
      const candidateIds = new Set<string>();
      if (typeof artifact.id === 'string') candidateIds.add(artifact.id);
      if (typeof artifact.metadata?.runtimeKey === 'string') candidateIds.add(artifact.metadata.runtimeKey);
      if (typeof artifact.metadata?.sourceImageId === 'string') candidateIds.add(artifact.metadata.sourceImageId);
      return {
        candidateIds,
        record: {
          asset,
          sourceRole: artifact.origin === 'generated' ? 'model' as const : ((artifact.metadata?.sourceRole === 'model' ? 'model' : 'user') as const),
          messageTimestamp: artifact.relatedMessageTimestamp
        }
      };
    })
    .filter((candidate): candidate is { candidateIds: Set<string>; record: SelectedReferenceRecord } => candidate !== null);
