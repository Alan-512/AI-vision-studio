import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createTrackedBlobUrl,
    retainBlobUrl,
    releaseBlobUrl,
    cleanupAllBlobUrls
} from '../services/storageService';

describe('StorageService - Blob URL Management', () => {

    beforeEach(() => {
        // Clean up any existing tracked URLs before each test
        cleanupAllBlobUrls();
        vi.clearAllMocks();
    });

    describe('createTrackedBlobUrl', () => {
        it('should create a blob URL and track it', () => {
            const blob = new Blob(['test content'], { type: 'text/plain' });
            const url = createTrackedBlobUrl(blob);

            expect(url).toBeDefined();
            expect(typeof url).toBe('string');
            // The mock returns 'blob:mock-url'
            expect(url).toBe('blob:mock-url');
        });
    });

    describe('retainBlobUrl', () => {
        it('should not throw for any URL', () => {
            expect(() => retainBlobUrl('blob:any-url')).not.toThrow();
        });
    });

    describe('releaseBlobUrl', () => {
        it('should handle releasing untracked URL gracefully', () => {
            expect(() => releaseBlobUrl('blob:does-not-exist')).not.toThrow();
        });
    });

    describe('cleanupAllBlobUrls', () => {
        it('should not throw when called', () => {
            expect(() => cleanupAllBlobUrls()).not.toThrow();
        });

        it('should be callable multiple times', () => {
            cleanupAllBlobUrls();
            cleanupAllBlobUrls();
            expect(true).toBe(true);
        });
    });
});
