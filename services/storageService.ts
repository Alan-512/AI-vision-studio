
import { Project, AssetItem } from '../types';

const DB_NAME = 'LuminaDB';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_ASSETS = 'assets';

let dbPromise: Promise<IDBDatabase> | null = null;

// --- Storage Management ---

export const initStoragePersistence = async (): Promise<boolean> => {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persisted();
    if (isPersisted) {
      return true;
    }
    const granted = await navigator.storage.persist();
    return granted;
  }
  return false;
};

export const getStorageEstimate = async (): Promise<{ usage: number; quota: number; percentage: number } | null> => {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    if (estimate.usage !== undefined && estimate.quota !== undefined) {
      return {
        usage: estimate.usage,
        quota: estimate.quota,
        percentage: (estimate.usage / estimate.quota) * 100
      };
    }
  }
  return null;
};

const getDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("IndexedDB error:", request.error);
      dbPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      const db = request.result;
      
      // Robustness: Handle connection closing events
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };

      db.onclose = () => {
        dbPromise = null;
      };

      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        const assetStore = db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        assetStore.createIndex('projectId', 'projectId', { unique: false });
      }
    };
  });
  return dbPromise;
};

// Helper: robust transaction creation with retry mechanism
const getTransaction = async (storeNames: string | string[], mode: IDBTransactionMode): Promise<IDBTransaction> => {
  let db = await getDB();
  try {
    return db.transaction(storeNames, mode);
  } catch (err: any) {
    // Check for specific error regarding closed connection
    if (err.name === 'InvalidStateError' || (err.message && err.message.includes('closing'))) {
      console.warn("LuminaDB connection was closed. Reopening...");
      dbPromise = null; // Clear cached promise
      db = await getDB(); // Re-open
      return db.transaction(storeNames, mode); // Retry
    }
    throw err;
  }
};

export const initDB = async (): Promise<void> => {
  await getDB();
  // Try to enable persistence silently on init
  initStoragePersistence().catch(console.warn);
};

// --- Projects ---

export const saveProject = async (project: Project): Promise<void> => {
  const transaction = await getTransaction(STORE_PROJECTS, 'readwrite');
  return new Promise((resolve, reject) => {
    const store = transaction.objectStore(STORE_PROJECTS);
    const request = store.put(project);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const loadProjects = async (): Promise<Project[]> => {
  const transaction = await getTransaction(STORE_PROJECTS, 'readonly');
  return new Promise((resolve, reject) => {
    const store = transaction.objectStore(STORE_PROJECTS);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

export const deleteProjectFromDB = async (projectId: string): Promise<void> => {
  const transaction = await getTransaction([STORE_PROJECTS, STORE_ASSETS], 'readwrite');
  return new Promise((resolve, reject) => {
    // Delete project
    const projectStore = transaction.objectStore(STORE_PROJECTS);
    projectStore.delete(projectId);

    // Delete associated assets (Hard delete)
    const assetStore = transaction.objectStore(STORE_ASSETS);
    const index = assetStore.index('projectId');
    const request = index.getAllKeys(projectId);

    request.onsuccess = () => {
      const keys = request.result;
      if (Array.isArray(keys)) {
        keys.forEach(key => assetStore.delete(key));
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

// --- Assets ---

export const saveAsset = async (asset: AssetItem): Promise<void> => {
  // Clone asset to avoid mutating the in-memory state
  const storageRecord: any = { ...asset };

  try {
    // 1. Optimize Image Storage: Convert Base64 Data URL to Blob
    if (asset.type === 'IMAGE' && asset.url.startsWith('data:')) {
       const response = await fetch(asset.url);
       const blob = await response.blob();
       storageRecord.blob = blob;
       storageRecord.url = 'blob'; // Placeholder, indicates data is in .blob field
    }
    
    // 2. Handle Video Blobs (existing logic)
    // blob: URLs are temporary. We must fetch the blob data and store it.
    else if (asset.type === 'VIDEO' && asset.url.startsWith('blob:')) {
      const response = await fetch(asset.url);
      const blob = await response.blob();
      storageRecord.blob = blob; // Store the binary data
      storageRecord.url = 'blob'; // Placeholder
    }
  } catch (e) {
    console.error("Failed to prepare asset blob for storage", e);
    // Continue attempting to save what we have (metadata) if blob fails
  }

  const transaction = await getTransaction(STORE_ASSETS, 'readwrite');
  return new Promise((resolve, reject) => {
    const store = transaction.objectStore(STORE_ASSETS);
    const request = store.put(storageRecord);

    request.onsuccess = () => resolve();
    
    request.onerror = (e: Event) => {
      const error = (e.target as IDBRequest).error;
      console.error("Asset Save Failed:", error);

      if (error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
         reject(new Error("STORAGE_QUOTA_EXCEEDED"));
      } else {
         reject(error);
      }
    };
  });
};

export const updateAsset = async (id: string, updates: Partial<AssetItem>): Promise<void> => {
  // Pre-process updates to handle Blob persistence
  const processedUpdates: any = { ...updates };
  
  // If we are updating a URL to a blob (common for Video generation completion), 
  // we must persist the actual Blob data, not just the temporary browser URL.
  if (typeof updates.url === 'string' && updates.url.startsWith('blob:')) {
      try {
          const response = await fetch(updates.url);
          const blob = await response.blob();
          processedUpdates.blob = blob;
          processedUpdates.url = 'blob'; // Placeholder used by loadAssets
      } catch (e) {
          console.error("Failed to persist blob in updateAsset", e);
          // Fallback: don't modify, try to save URL as is (will likely fail on reload but better than crash)
      }
  }

  const transaction = await getTransaction(STORE_ASSETS, 'readwrite');
  return new Promise((resolve, reject) => {
    const store = transaction.objectStore(STORE_ASSETS);
    const request = store.get(id);

    request.onsuccess = () => {
      const data = request.result;
      if (data) {
        // Merge existing data with processed updates
        const updatedData = { ...data, ...processedUpdates };
        const putRequest = store.put(updatedData);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        // Only reject if we really need to. Sometimes updates race conditions happen.
        console.warn(`Asset ${id} not found for update.`);
        resolve(); // resolve anyway to prevent app crash
      }
    };
    request.onerror = () => reject(request.error);
  });
};

export const loadAssets = async (): Promise<AssetItem[]> => {
  const transaction = await getTransaction(STORE_ASSETS, 'readonly');
  return new Promise((resolve, reject) => {
    const store = transaction.objectStore(STORE_ASSETS);
    const request = store.getAll();

    request.onsuccess = () => {
      const rawAssets = request.result || [];
      // Rehydrate Blobs to URLs
      const assets = rawAssets.map((record: any) => {
        // Generic Blob Rehydration (Works for both IMAGE and VIDEO now)
        if (record.blob instanceof Blob) {
           const newUrl = URL.createObjectURL(record.blob);
           // We do not modify the record in DB, just the returned object for the app
           return { ...record, url: newUrl, blob: undefined }; 
        }
        return record;
      });
      // Sort by newest first
      assets.sort((a: AssetItem, b: AssetItem) => b.createdAt - a.createdAt);
      resolve(assets);
    };
    request.onerror = () => reject(request.error);
  });
};

// Update: This is now a "Permanent Delete"
export const permanentlyDeleteAssetFromDB = async (assetId: string): Promise<void> => {
  const transaction = await getTransaction(STORE_ASSETS, 'readwrite');
  return new Promise((resolve, reject) => {
     const store = transaction.objectStore(STORE_ASSETS);
     const request = store.delete(assetId);
     request.onsuccess = () => resolve();
     request.onerror = () => reject(request.error);
  });
};

// New: Soft Delete (Move to Recycle Bin)
export const softDeleteAssetInDB = async (asset: AssetItem): Promise<void> => {
    const updatedAsset = { ...asset, deletedAt: Date.now() };
    // Reuse saveAsset to update the record with deletedAt
    return saveAsset(updatedAsset);
};

// New: Restore from Recycle Bin
export const restoreAssetInDB = async (asset: AssetItem): Promise<void> => {
    const updatedAsset = { ...asset, deletedAt: undefined };
    delete updatedAsset.deletedAt; // Remove key
    return saveAsset(updatedAsset);
};
