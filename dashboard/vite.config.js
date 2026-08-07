import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react') || id.includes('lucide')) {
              return 'lucide';
            }
            if (id.includes('react-dom')) {
              return 'react-dom';
            }
            if (id.includes('supabase')) {
              return 'supabase';
            }
            return 'vendor';
          }
          if (id.includes('views')) {
            const viewMatch = id.match(/views\/(\w+)/);
            if (viewMatch) {
              return `view-${viewMatch[1]}`;
            }
          }
        }
      }
    }
  }
})
