import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Custom plugin to strip the problematic importmap injected by the cloud environment
const removeAiStudioImportMap = () => {
  return {
    name: 'remove-ai-studio-importmap',
    enforce: 'pre', // Run this before any other HTML transformation
    transformIndexHtml: (html) => {
      // Robust regex to remove <script type="importmap"> and all its content
      return html.replace(/<script type="importmap">[\s\S]*?<\/script>/gi, '');
    }
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    removeAiStudioImportMap(), // Apply the cleaner plugin first
    react()
  ],
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
  }
});