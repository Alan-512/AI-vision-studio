import { describe, expect, it, vi } from 'vitest';
import type { AssetItem } from '../types';
import { createAssetProjectionController, publishGeneratedAsset, stagePendingAsset } from '../services/assetProjectionPersistence';

const createAsset = (overrides: Partial<AssetItem> = {}): AssetItem => ({
  id: 'task-1',
  projectId: 'project-1',
  type: 'IMAGE',
  url: 'blob://asset',
  prompt: 'poster',
  createdAt: 1710000000000,
  status: 'COMPLETED',
  ...overrides
});

describe('assetProjectionPersistence', () => {
  it('publishes a generated asset through persistence, state sync, and callbacks', async () => {
    const asset = createAsset();
    const saveAsset = vi.fn().mockResolvedValue(undefined);
    const setAssets = vi.fn();
    const onPreview = vi.fn();
    const onSuccess = vi.fn().mockResolvedValue(undefined);

    const published = await publishGeneratedAsset(asset, {
      taskId: 'task-1',
      currentProjectId: 'project-1'
    }, {
      activeProjectIdRef: { current: 'project-1' },
      setAssets,
      saveAsset,
      onPreview,
      onSuccess
    });

    expect(published).toBe(asset);
    expect(saveAsset).toHaveBeenCalledWith(asset);
    expect(setAssets).toHaveBeenCalledTimes(1);
    const replaceTaskAsset = setAssets.mock.calls[0][0] as (assets: AssetItem[]) => AssetItem[];
    expect(replaceTaskAsset([createAsset({ id: 'task-1', status: 'PENDING' }), createAsset({ id: 'other-task' })])).toEqual([
      asset,
      createAsset({ id: 'other-task' })
    ]);
    expect(onPreview).toHaveBeenCalledWith(asset);
    expect(onSuccess).toHaveBeenCalledWith(asset);
  });

  it('skips visible asset replacement when the active project no longer matches', async () => {
    const asset = createAsset();
    const saveAsset = vi.fn().mockResolvedValue(undefined);
    const setAssets = vi.fn();

    await publishGeneratedAsset(asset, {
      taskId: 'task-1',
      currentProjectId: 'project-1'
    }, {
      activeProjectIdRef: { current: 'project-2' },
      setAssets,
      saveAsset
    });

    expect(saveAsset).toHaveBeenCalledWith(asset);
    expect(setAssets).not.toHaveBeenCalled();
  });

  it('creates an asset projection controller that reuses shared deps and options', async () => {
    const asset = createAsset();
    const saveAsset = vi.fn().mockResolvedValue(undefined);
    const setAssets = vi.fn();
    const onPreview = vi.fn();
    const onSuccess = vi.fn();
    const controller = createAssetProjectionController({
      options: {
        taskId: 'task-1',
        currentProjectId: 'project-1'
      },
      deps: {
        activeProjectIdRef: { current: 'project-1' },
        setAssets,
        saveAsset,
        onPreview,
        onSuccess
      }
    });

    await controller.publishGeneratedAsset(asset);

    expect(saveAsset).toHaveBeenCalledWith(asset);
    expect(setAssets).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(asset);
    expect(onSuccess).toHaveBeenCalledWith(asset);
  });

  it('stages a pending asset through persistence and visible insertion', async () => {
    const asset = createAsset({ status: 'PENDING', url: '' });
    const saveAsset = vi.fn().mockResolvedValue(undefined);
    const setAssets = vi.fn();

    await stagePendingAsset(asset, {
      currentProjectId: 'project-1'
    }, {
      activeProjectIdRef: { current: 'project-1' },
      setAssets,
      saveAsset
    });

    expect(saveAsset).toHaveBeenCalledWith(asset);
    expect(setAssets).toHaveBeenCalledTimes(1);
    const insertPendingAsset = setAssets.mock.calls[0][0] as (assets: AssetItem[]) => AssetItem[];
    expect(insertPendingAsset([createAsset({ id: 'existing-1' })])).toEqual([
      asset,
      createAsset({ id: 'existing-1' })
    ]);
  });

  it('patches a task asset through persistence and visible state sync', async () => {
    const updateAsset = vi.fn().mockResolvedValue(undefined);
    const setAssets = vi.fn();
    const controller = createAssetProjectionController({
      options: {
        taskId: 'task-1',
        currentProjectId: 'project-1'
      },
      deps: {
        activeProjectIdRef: { current: 'project-1' },
        setAssets,
        saveAsset: vi.fn().mockResolvedValue(undefined),
        updateAsset
      }
    });

    await controller.patchTaskAsset({
      persistedPatch: { status: 'GENERATING' },
      visiblePatch: { status: 'GENERATING', operationName: 'op-1' }
    });

    expect(updateAsset).toHaveBeenCalledWith('task-1', { status: 'GENERATING' });
    expect(setAssets).toHaveBeenCalledTimes(1);
    const applyPatch = setAssets.mock.calls[0][0] as (assets: AssetItem[]) => AssetItem[];
    expect(applyPatch([createAsset({ id: 'task-1', status: 'PENDING' }), createAsset({ id: 'other-task' })])).toEqual([
      createAsset({ id: 'task-1', status: 'GENERATING', operationName: 'op-1' }),
      createAsset({ id: 'other-task' })
    ]);
  });

  it('persists a task asset patch without touching visible state when no visible patch is provided', async () => {
    const updateAsset = vi.fn().mockResolvedValue(undefined);
    const setAssets = vi.fn();
    const controller = createAssetProjectionController({
      options: {
        taskId: 'task-1',
        currentProjectId: 'project-1'
      },
      deps: {
        activeProjectIdRef: { current: 'project-1' },
        setAssets,
        saveAsset: vi.fn().mockResolvedValue(undefined),
        updateAsset
      }
    });

    await controller.patchTaskAsset({
      persistedPatch: { operationName: 'op-2' }
    });

    expect(updateAsset).toHaveBeenCalledWith('task-1', { operationName: 'op-2' });
    expect(setAssets).not.toHaveBeenCalled();
  });
});
