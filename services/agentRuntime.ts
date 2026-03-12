import { AgentJob, ChatMessage, JobArtifact, SearchProgress, SmartAsset } from '../types';

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

export const extractImagesFromMessage = (message: ChatMessage): string[] => {
  if (message.images && message.images.length > 0) return message.images;
  if (message.image) return [message.image];
  return [];
};

export const dataUrlToSmartAsset = (imgData: string, id: string): SmartAsset | null => {
  const match = imgData.match(/^data:(.+);base64,(.+)$/);
  return match ? { id, mimeType: match[1], data: match[2] } : null;
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
