import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          atlas: ['./src/views/AtlasView.jsx'],
          pipeline: ['./src/views/PipelineFlowView.jsx'],
          newsroom: ['./src/views/NewsroomView.jsx'],
          heartbeat: ['./src/views/HeartbeatWallView.jsx'],
          quality: ['./src/views/QualityTrendView.jsx'],
          replies: ['./src/views/RepliesInboxView.jsx'],
          cockpit: ['./src/views/CockpitView.jsx'],
          ghl: ['./src/views/GHLView.jsx'],
          leads: ['./src/views/LeadsView.jsx'],
        }
      }
    }
  }
})
