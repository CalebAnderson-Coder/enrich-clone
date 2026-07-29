import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('AtlasView')) return 'atlas';
          if (id.includes('PipelineFlowView')) return 'pipeline';
          if (id.includes('NewsroomView')) return 'newsroom';
          if (id.includes('HeartbeatWallView')) return 'heartbeat';
          if (id.includes('QualityTrendView')) return 'quality';
          if (id.includes('RepliesInboxView')) return 'replies';
          if (id.includes('LeadsView')) return 'leads';
          if (id.includes('CampaignView')) return 'campaign';
          if (id.includes('GHLView')) return 'ghl';
        }
      }
    },
    chunkSizeWarningLimit: 500,
  }
})
