import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'lucide': ['lucide-react'],
          'views-performance': ['./src/views/PerformanceView.jsx'],
          'views-calendar': ['./src/views/CalendarView.jsx'],
          'views-integrations': ['./src/views/IntegrationsView.jsx'],
          'views-files': ['./src/views/FilesView.jsx'],
          'views-profile': ['./src/views/ProfileView.jsx'],
          'views-history': ['./src/views/HistoryView.jsx'],
          'views-leads': ['./src/views/LeadsView.jsx'],
          'views-campaign': ['./src/views/CampaignView.jsx'],
          'views-cockpit': ['./src/views/CockpitView.jsx'],
          'views-ghl': ['./src/views/GHLView.jsx'],
          'views-newsroom': ['./src/views/NewsroomView.jsx'],
          'views-heartbeat': ['./src/views/HeartbeatWallView.jsx'],
          'views-pipeline': ['./src/views/PipelineFlowView.jsx'],
          'views-quality': ['./src/views/QualityTrendView.jsx'],
          'views-atlas': ['./src/views/AtlasView.jsx'],
          'views-replies': ['./src/views/RepliesInboxView.jsx'],
        }
      }
    },
    chunkSizeWarningLimit: 1000,
  }
})
