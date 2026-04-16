import PageContainer from '@/components/layout/page-container';
import LeadsDashboard from '@/features/leads/components/leads-dashboard';
import { leadsInfoContent } from '@/features/leads/info-content';

export const metadata = {
  title: 'Dashboard: Leads Precualificados'
};

export default function LeadsPage() {
  return (
    <PageContainer
      scrollable={true}
      pageTitle='Leads Precualificados'
      pageDescription='Visualiza y atiende a los prospectos pre-cualificados extraídos por tu Agente IA.'
      infoContent={leadsInfoContent}
    >
      <LeadsDashboard />
    </PageContainer>
  );
}
