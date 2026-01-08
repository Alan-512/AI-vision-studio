/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Custom plugin to strip the problematic importmap injected by the cloud environment
const removeAiStudioImportMap = () => ({
  name: 'remove-ai-studio-importmap',
  enforce: 'pre' as const,
  transformIndexHtml: (html: string) => {
    return html.replace(/<script type="importmap">[\s\S]*?<\/script>/gi, '');
  }
});

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Use mode parameter instead of process.env which may not be available in config context
  const enableDebugLogs = mode === 'development' || mode === 'debug';
  const shouldDropConsole = command === 'build' && !enableDebugLogs;

  return {
    plugins: [
      removeAiStudioImportMap(),
      react()
    ] as any,
    // FIX [PRF-001]: Strip console.log in production builds unless debug logs are enabled
    esbuild: shouldDropConsole ? { drop: ['console', 'debugger'] } : undefined,
    build: {
      target: 'esnext',
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor': ['react', 'react-dom', 'lucide-react', 'react-markdown'],
            'genai': ['@google/genai']
          }
        }
      }
    },
    // Explicitly optimize dependencies to ensure Vite bundles the local node_modules
    // instead of trying to resolve them externally
    optimizeDeps: {
      include: ['react', 'react-dom', '@google/genai', 'lucide-react', 'react-markdown']
    },
    // Vitest configuration
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']
    }
  };
});
