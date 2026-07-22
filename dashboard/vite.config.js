import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react')) {
              return 'vendor-react';
            }
            if (id.includes('lucide-react') || id.includes('framer-motion')) {
              return 'vendor-ui';
            }
            return 'vendor-other';
          }
          if (id.includes('views/QualityTrendView') || id.includes('views/PerformanceView')) {
            return 'chunk-charts';
          }
          if (id.includes('views/HeartbeatWallView') || id.includes('views/NewsroomView') || 
              id.includes('views/RepliesInboxView') || id.includes('views/LeadsView') || 
              id.includes('views/GHLView')) {
            return 'chunk-heavy';
          }
          if (id.includes('views/')) {
            return 'chunk-views';
          }
        }
      }
    },
    chunkSizeWarningLimit: 500,
  }
})
