import type { AssetItem } from '../types';

type AssetProjectionStateDeps = {
  activeProjectIdRef: { current: string | null };
  setAssets: (updater: (assets: AssetItem[]) => AssetItem[]) => void;
};

type AssetProjectionPersistenceDeps = {
  saveAsset: (asset: AssetItem) => Promise<void>;
  updateAsset?: (assetId: string, updates: Partial<AssetItem>) => Promise<void>;
};

type AssetProjectionCallbackDeps = {
  onPreview?: (asset: AssetItem) => void;
  onSuccess?: (asset: AssetItem) => Promise<void> | void;
};

export const publishGeneratedAsset = async (
  asset: AssetItem,
  options: {
    taskId: string;
    currentProjectId: string;
  },
  deps: AssetProjectionStateDeps & AssetProjectionPersistenceDeps & AssetProjectionCallbackDeps
): Promise<AssetItem> => {
  await deps.saveAsset(asset);
  if (deps.activeProjectIdRef.current === options.currentProjectId) {
    deps.setAssets(assets => assets.map(existing => existing.id === options.taskId ? asset : existing));
  }
  deps.onPreview?.(asset);
  if (deps.onSuccess) {
    void deps.onSuccess(asset);
  }
  return asset;
};

export const stagePendingAsset = async (
  asset: AssetItem,
  options: {
    currentProjectId: string;
  },
  deps: AssetProjectionStateDeps & AssetProjectionPersistenceDeps
): Promise<AssetItem> => {
  await deps.saveAsset(asset);
  if (deps.activeProjectIdRef.current === options.currentProjectId) {
    deps.setAssets(assets => [asset, ...assets]);
  }
  return asset;
};

export const patchGeneratedAsset = async (
  patches: {
    persistedPatch: Partial<AssetItem>;
    visiblePatch?: Partial<AssetItem>;
  },
  options: {
    taskId: string;
    currentProjectId: string;
  },
  deps: AssetProjectionStateDeps & AssetProjectionPersistenceDeps
): Promise<void> => {
  if (!deps.updateAsset) {
    throw new Error('updateAsset dependency is required to patch generated assets');
  }
  await deps.updateAsset(options.taskId, patches.persistedPatch);
  if (patches.visiblePatch && deps.activeProjectIdRef.current === options.currentProjectId) {
    deps.setAssets(assets => assets.map(existing => existing.id === options.taskId ? { ...existing, ...patches.visiblePatch } : existing));
  }
};

export const createAssetProjectionController = ({
  options,
  deps
}: {
  options: {
    taskId: string;
    currentProjectId: string;
  };
  deps: AssetProjectionStateDeps & AssetProjectionPersistenceDeps & AssetProjectionCallbackDeps;
}) => ({
  stagePendingAsset: (asset: AssetItem) => stagePendingAsset(asset, {
    currentProjectId: options.currentProjectId
  }, deps),
  publishGeneratedAsset: (asset: AssetItem) => publishGeneratedAsset(asset, options, deps),
  patchTaskAsset: (patches: {
    persistedPatch: Partial<AssetItem>;
    visiblePatch?: Partial<AssetItem>;
  }) => patchGeneratedAsset(patches, options, deps)
});
