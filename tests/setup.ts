// Test Setup File
// This file runs before all tests to set up the test environment

import { vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';

// Mock localStorage with proper Map-based implementation
const localStorageStore = new Map<string, string>();
const localStorageMock = {
    getItem: (key: string) => localStorageStore.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageStore.set(key, value),
    removeItem: (key: string) => localStorageStore.delete(key),
    clear: () => localStorageStore.clear(),
    get length() { return localStorageStore.size; },
    key: (index: number) => Array.from(localStorageStore.keys())[index] ?? null,
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock IndexedDB (basic mock for storageService tests)
const indexedDBMock = {
    open: vi.fn(),
};
Object.defineProperty(window, 'indexedDB', { value: indexedDBMock });

// Mock URL.createObjectURL and revokeObjectURL
(globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:mock-url');
(globalThis as any).URL.revokeObjectURL = vi.fn();

// Clean up after each test
afterEach(() => {
    vi.clearAllMocks();
});
