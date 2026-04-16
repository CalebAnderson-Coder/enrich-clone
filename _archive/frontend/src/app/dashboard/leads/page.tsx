import PageContainer from '@/components/layout/page-container';
import LeadListingPage from '@/features/leads/components/lead-listing';
import { searchParamsCache } from '@/lib/searchparams';
import type { SearchParams } from 'nuqs/server';
import { leadsInfoContent } from '@/features/leads/info-content';
import { LeadFormSheetTrigger } from '@/features/leads/components/lead-form-sheet';
import { ProspectModalTrigger } from '@/features/leads/components/prospect-modal';

export const metadata = {
  title: 'Dashboard: Leads'
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function LeadsPage(props: PageProps) {
  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    <PageContainer
      scrollable={false}
      pageTitle='Leads'
      pageDescription='Manage leads (React Query + nuqs table pattern.)'
      infoContent={leadsInfoContent}
      pageHeaderAction={
        <div className="flex items-center gap-2">
          <LeadFormSheetTrigger />
          <ProspectModalTrigger />
        </div>
      }
    >
      <LeadListingPage />
    </PageContainer>
  );
}
