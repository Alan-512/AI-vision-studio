import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // This ensures that process.env reference in the code doesn't crash the browser
    // If you have actual env vars during build, they will be injected here.
    'process.env': {} 
  }
});