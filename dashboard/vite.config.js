import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          const criticalViews = ['CockpitView', 'AtlasView', 'PipelineFlowView'];
          const secondaryViews = ['NewsroomView', 'HeartbeatWallView', 'QualityTrendView', 'RepliesInboxView', 'GHLView', 'LeadsView'];
          const tertiaryViews = ['PerformanceView', 'CampaignView', 'CalendarView', 'FilesView', 'ProfileView', 'IntegrationsView', 'HistoryView'];
          
          if (id.includes('/views/')) {
            for (const view of criticalViews) {
              if (id.includes(view)) return 'views-critical';
            }
            for (const view of secondaryViews) {
              if (id.includes(view)) return 'views-secondary';
            }
            for (const view of tertiaryViews) {
              if (id.includes(view)) return 'views-tertiary';
            }
          }
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) return 'lucide';
            if (id.includes('react-dom') || id.includes('react')) return 'react-vendor';
            if (id.includes('tailwindcss') || id.includes('tailwind')) return 'tailwind';
            return 'vendor';
          }
        }
      }
    }
  }
})
