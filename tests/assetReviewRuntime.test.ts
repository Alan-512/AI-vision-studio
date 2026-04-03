import { describe, expect, it, vi } from 'vitest';
import type { AssetItem } from '../types';
import { reviewGeneratedAsset, reviewGeneratedAssetLocally } from '../services/assetReviewRuntime';

const createAsset = (overrides: Partial<AssetItem> = {}): AssetItem => ({
  id: 'asset-1',
  projectId: 'project-1',
  type: 'IMAGE',
  url: 'blob://asset',
  prompt: 'poster',
  createdAt: 1710000000000,
  status: 'COMPLETED',
  ...overrides
});

describe('assetReviewRuntime', () => {
  it('returns an auto-revise local review when an image asset is missing a renderable url', () => {
    const review = reviewGeneratedAssetLocally(createAsset({
      type: 'IMAGE',
      url: ''
    }), 'poster prompt');

    expect(review.decision).toBe('auto_revise');
    expect(review.revisedPrompt).toContain('Revision note');
    expect(review.reviewPlan?.executionMode).toBe('auto');
  });

  it('returns a warning-only local review when a video asset lacks videoUri', () => {
    const review = reviewGeneratedAssetLocally(createAsset({
      type: 'VIDEO',
      videoUri: undefined
    }), 'video prompt');

    expect(review.decision).toBe('accept');
    expect(review.warnings[0]).toContain('videoUri');
    expect(review.issues?.[0]?.type).toBe('other');
  });

  it('falls back to local review when normalized image data cannot be converted to inline image bytes', async () => {
    const normalizeImageUrl = vi.fn().mockResolvedValue('https://example.com/not-inline');
    const reviewGeneratedImage = vi.fn();

    const review = await reviewGeneratedAsset(createAsset(), 'poster prompt', undefined, {
      normalizeImageUrl,
      reviewGeneratedImage
    });

    expect(normalizeImageUrl).toHaveBeenCalledWith('blob://asset');
    expect(reviewGeneratedImage).not.toHaveBeenCalled();
    expect(review.decision).toBe('accept');
  });
});
