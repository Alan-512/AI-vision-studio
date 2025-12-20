
import { Project, AssetItem, AppMode } from '../types';

const DB_NAME = 'LuminaDB';
const DB_VERSION = 2; // Bumped version to ensure schema upgrade runs
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
      const transaction = (event.target as IDBOpenDBRequest).transaction;
      
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      
      let assetStore;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        assetStore = db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
      } else {
        // CRITICAL FIX: If store exists but we are upgrading, get reference to it
        assetStore = transaction!.objectStore(STORE_ASSETS);
      }

      // CRITICAL FIX: Check if index exists before creating, regardless of store creation time
      if (!assetStore.indexNames.contains('projectId')) {
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

// --- Orphan Recovery ---

export const recoverOrphanedProjects = async (): Promise<void> => {
  try {
    const transaction = await getTransaction([STORE_PROJECTS, STORE_ASSETS], 'readwrite');
    return new Promise((resolve, reject) => {
      const projectStore = transaction.objectStore(STORE_PROJECTS);
      const assetStore = transaction.objectStore(STORE_ASSETS);
      
      // Get all valid project IDs
      const projectsRequest = projectStore.getAllKeys();
      
      projectsRequest.onsuccess = () => {
        const projectIds = new Set(projectsRequest.result as string[]);
        
        // Get all assets
        const assetsRequest = assetStore.getAll();
        
        assetsRequest.onsuccess = () => {
          const assets = assetsRequest.result as AssetItem[];
          // Find assets that point to a non-existent project
          const orphanedAssets = assets.filter(a => !projectIds.has(a.projectId));
          
          if (orphanedAssets.length > 0) {
            console.warn(`[Storage] Found ${orphanedAssets.length} orphaned assets. Recovering...`);
            
            // Create a recovery project
            const recoveryProjectId = 'recovered-' + Date.now();
            const recoveryProject: Project = {
              id: recoveryProjectId,
              name: 'Recovered Assets',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              savedMode: AppMode.IMAGE,
              chatHistory: [],
              videoChatHistory: []
            };
            
            projectStore.put(recoveryProject);
            
            // Link orphans to this new project
            orphanedAssets.forEach(asset => {
              asset.projectId = recoveryProjectId;
              assetStore.put(asset);
            });
            
            console.log(`[Storage] Recovered ${orphanedAssets.length} assets into '${recoveryProject.name}'`);
          }
          resolve();
        };
        assetsRequest.onerror = () => reject(assetsRequest.error);
      };
      projectsRequest.onerror = () => reject(projectsRequest.error);
    });
  } catch (e) {
    console.error("Failed to run orphan recovery", e);
    // Don't block app init
    return Promise.resolve();
  }
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
    // Safe check for index existence before using it
    if (assetStore.indexNames.contains('projectId')) {
        const index = assetStore.index('projectId');
        const request = index.getAllKeys(projectId);

        request.onsuccess = () => {
          const keys = request.result;
          if (Array.isArray(keys)) {
            keys.forEach(key => assetStore.delete(key));
          }
        };
    } else {
        // Fallback: iterate cursor (slower but safe) if index missing
        const request = assetStore.openCursor();
        request.onsuccess = (e: any) => {
            const cursor = e.target.result;
            if (cursor) {
                if (cursor.value.projectId === projectId) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

// --- Assets ---

export const saveAsset = async (asset: AssetItem): Promise<void> => {
  // Clone asset to avoid mutating the in-memory state
  const storageRecord: any = { ...asset };

  // STRICT VALIDATION: Ensure we never save a broken record for COMPLETED assets
  try {
    // 1. Image Optimization & Persistence
    if (asset.type === 'IMAGE' && asset.url.startsWith('data:')) {
       try {
           const response = await fetch(asset.url);
           const blob = await response.blob();
           storageRecord.blob = blob;
           storageRecord.url = 'blob'; 
       } catch (conversionError) {
           console.warn("Blob conversion failed for image", conversionError);
           // Fallback: Try saving string if small enough, otherwise this might fail Quota later
       }
    }
    
    // 2. Video Persistence (CRITICAL)
    // Videos are usually 'blob:http...' URLs. We MUST convert these to stored Blobs.
    else if (asset.type === 'VIDEO' && asset.url.startsWith('blob:')) {
      try {
          const response = await fetch(asset.url);
          const blob = await response.blob();
          if (!blob || blob.size === 0) throw new Error("Empty blob received");
          
          storageRecord.blob = blob; 
          storageRecord.url = 'blob'; // Placeholder
      } catch (conversionError: any) {
          console.error("Critical: Failed to persist video blob", conversionError);
          // ABORT SAVE: If we can't save the video data, we shouldn't save the record at all.
          // Otherwise, the user sees a broken video on reload.
          throw new Error("DATA_INTEGRITY_FAIL: Could not persist video data. " + conversionError.message);
      }
    }
  } catch (e) {
    // Re-throw to be caught by UI
    throw e;
  }

  const transaction = await getTransaction(STORE_ASSETS, 'readwrite');
  return new Promise((resolve, reject) => {
    const store = transaction.objectStore(STORE_ASSETS);
    
    // SAFETY CHECK: Don't save if it's missing vital data for a completed asset
    if (storageRecord.status === 'COMPLETED' && !storageRecord.blob && (!storageRecord.url || storageRecord.url === 'blob')) {
        reject(new Error("Cannot save asset: Missing URL and Blob data"));
        return;
    }
    
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
  // we must persist the actual Blob data.
  if (typeof updates.url === 'string' && updates.url.startsWith('blob:')) {
      try {
          const response = await fetch(updates.url);
          const blob = await response.blob();
          if (!blob || blob.size === 0) throw new Error("Empty blob from update");
          
          processedUpdates.blob = blob;
          processedUpdates.url = 'blob'; 
      } catch (e) {
          console.error("Failed to persist blob in updateAsset", e);
          // For updates, we might be updating status to FAILED, so we shouldn't crash here.
          // But if we are setting it to COMPLETED, this is bad.
          if (updates.status === 'COMPLETED') {
              throw new Error("Failed to save video data during update.");
          }
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
        
        // Ensure we don't lose the blob if it existed and wasn't overwritten
        if (data.blob && !processedUpdates.blob && processedUpdates.url === 'blob') {
             updatedData.blob = data.blob;
        }

        const putRequest = store.put(updatedData);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        console.warn(`Asset ${id} not found for update.`);
        resolve(); // resolve anyway to prevent app crash
      }
    };
    request.onerror = () => reject(request.error);
  });
};

// --- Memory Leak Prevention: URL Registry ---
// Track all active Blob URLs created by this service
const activeBlobUrls: string[] = [];

/**
 * Helper to cleanup previously allocated Blob URLs from memory.
 * This prevents memory leaks where the browser holds onto Blob references indefinitely.
 */
const cleanupBlobUrls = () => {
  if (activeBlobUrls.length > 0) {
    // console.debug(`[Storage] Cleaning up ${activeBlobUrls.length} blob URLs to free memory.`);
    activeBlobUrls.forEach(url => URL.revokeObjectURL(url));
    activeBlobUrls.length = 0; // Clear the registry
  }
};

export const loadAssets = async (projectId?: string): Promise<AssetItem[]> => {
  // STEP 1: Perform cleanup before loading new assets
  cleanupBlobUrls();

  const transaction = await getTransaction(STORE_ASSETS, 'readonly');
  return new Promise((resolve, reject) => {
    const store = transaction.objectStore(STORE_ASSETS);
    let request;

    // Filter by Project ID if provided (Performance & Memory Optimization)
    if (projectId && store.indexNames.contains('projectId')) {
        const index = store.index('projectId');
        request = index.getAll(projectId);
    } else {
        // Fallback: Get all (and filter in JS if needed) if index missing or no projectId
        request = store.getAll();
    }

    request.onsuccess = () => {
      let rawAssets = request.result || [];
      
      // Manual filter fallback if we couldn't use index
      if (projectId && !store.indexNames.contains('projectId')) {
         rawAssets = rawAssets.filter((a: any) => a.projectId === projectId);
      }

      // Rehydrate Blobs to URLs
      const assets = rawAssets.map((record: any) => {
        // Generic Blob Rehydration (Works for both IMAGE and VIDEO now)
        if (record.blob instanceof Blob) {
           const newUrl = URL.createObjectURL(record.blob);
           
           // STEP 2: Register the new URL so we can clean it up later
           activeBlobUrls.push(newUrl);

           // We do not modify the record in DB, just the returned object for the app
           return { ...record, url: newUrl, blob: undefined }; 
        }
        
        // FALLBACK: If URL is 'blob' but blob data is missing (corruption check)
        if (record.url === 'blob' && !record.blob) {
            return { ...record, status: 'FAILED', url: '', metadata: { ...record.metadata, error: 'Storage Corruption: Data missing' } };
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
    // Optimization: Just update the specific field without re-saving Blobs
    const transaction = await getTransaction(STORE_ASSETS, 'readwrite');
    return new Promise((resolve, reject) => {
        const store = transaction.objectStore(STORE_ASSETS);
        const getRequest = store.get(asset.id);
        
        getRequest.onsuccess = () => {
            const data = getRequest.result;
            if (data) {
                data.deletedAt = Date.now();
                store.put(data); // Commit update
            }
            resolve();
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
};

// New: Restore from Recycle Bin
export const restoreAssetInDB = async (asset: AssetItem): Promise<void> => {
    const transaction = await getTransaction(STORE_ASSETS, 'readwrite');
    return new Promise((resolve, reject) => {
        const store = transaction.objectStore(STORE_ASSETS);
        const getRequest = store.get(asset.id);
        
        getRequest.onsuccess = () => {
            const data = getRequest.result;
            if (data) {
                delete data.deletedAt;
                store.put(data); // Commit update
            }
            resolve();
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
};

// --- BULK OPERATIONS (PERFORMANCE OPTIMIZATION) ---

/**
 * Efficiently deletes multiple assets in a SINGLE transaction to avoid blocking the main thread.
 */
export const bulkPermanentlyDeleteAssets = async (assetIds: string[]): Promise<void> => {
    if (assetIds.length === 0) return;
    const transaction = await getTransaction(STORE_ASSETS, 'readwrite');
    const store = transaction.objectStore(STORE_ASSETS);
    
    // We don't await individual requests, we await the transaction completion
    assetIds.forEach(id => {
        store.delete(id);
    });

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

/**
 * Efficiently soft-deletes multiple assets in a SINGLE transaction.
 * Updates 'deletedAt' timestamp without re-processing image blobs.
 */
export const bulkSoftDeleteAssets = async (assets: AssetItem[]): Promise<void> => {
    if (assets.length === 0) return;
    const transaction = await getTransaction(STORE_ASSETS, 'readwrite');
    const store = transaction.objectStore(STORE_ASSETS);
    
    // We need to fetch, modify, and put for each asset
    // Since we are inside a transaction, we can just iterate.
    // NOTE: For 100+ items, fetch-modify-put might still be slow inside one tx.
    // A faster way is to assume we have the latest asset data, but we need to be careful about Blobs.
    // 'asset' passed from UI might contain a blob URL, but DB expects a Blob object if it was stored as one.
    // To be safe and fast, we use a Cursor to iterate and update.
    
    return new Promise((resolve, reject) => {
        const assetIds = new Set(assets.map(a => a.id));
        const cursorRequest = store.openCursor();
        
        cursorRequest.onsuccess = (e: any) => {
            const cursor = e.target.result;
            if (cursor) {
                if (assetIds.has(cursor.value.id)) {
                    const record = cursor.value;
                    record.deletedAt = Date.now();
                    cursor.update(record);
                }
                cursor.continue();
            } 
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};
