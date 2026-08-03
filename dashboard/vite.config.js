import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-lib': ['lucide-react'],
          'views-1': ['./src/views/AtlasView.jsx', './src/views/NewsroomView.jsx', './src/views/HeartbeatWallView.jsx'],
          'views-2': ['./src/views/PipelineFlowView.jsx', './src/views/QualityTrendView.jsx', './src/views/RepliesInboxView.jsx'],
          'views-3': ['./src/views/LeadsView.jsx', './src/views/GHLView.jsx', './src/views/PerformanceView.jsx'],
          'views-4': ['./src/views/CampaignView.jsx', './src/views/CalendarView.jsx', './src/views/FilesView.jsx', './src/views/IntegrationsView.jsx', './src/views/HistoryView.jsx', './src/views/ProfileView.jsx'],
        }
      }
    }
  }
})
