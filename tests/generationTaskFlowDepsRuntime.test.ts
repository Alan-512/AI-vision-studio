import { describe, expect, it, vi } from 'vitest';
import { createGenerationTaskFlowDeps } from '../services/generationTaskFlowDepsRuntime';

describe('generationTaskFlowDepsRuntime', () => {
  it('delegates stagePendingAsset and normalizeGenerationParams through provided dependencies', () => {
    const stagePendingAsset = vi.fn();
    const normalizeGenerationParams = vi.fn().mockReturnValue({ prompt: 'normalized' });

    const deps = createGenerationTaskFlowDeps({
      taskRuntime: {
        stagePendingAsset
      } as any,
      taskContext: {} as any,
      generationDeps: {
        normalizeGenerationParams
      } as any
    });

    deps.stagePendingAsset({ id: 'asset-1' } as any);
    const normalized = deps.normalizeGenerationParams();

    expect(stagePendingAsset).toHaveBeenCalledWith({ id: 'asset-1' });
    expect(normalized).toEqual({ prompt: 'normalized' });
  });

  it('delegates failure resolution through provided dependency factory', async () => {
    const resolveGenerationFailure = vi.fn().mockResolvedValue({ toolResult: { status: 'error' } });

    const deps = createGenerationTaskFlowDeps({
      taskRuntime: {} as any,
      taskContext: {} as any,
      generationDeps: {
        resolveGenerationFailure
      } as any
    });

    const result = await deps.resolveGenerationFailure({
      error: new Error('boom'),
      latestVisibleAsset: null,
      taskMarkedVisibleComplete: false
    });

    expect(resolveGenerationFailure).toHaveBeenCalledWith({
      error: expect.any(Error),
      latestVisibleAsset: null,
      taskMarkedVisibleComplete: false
    });
    expect(result).toEqual({ toolResult: { status: 'error' } });
  });
});
