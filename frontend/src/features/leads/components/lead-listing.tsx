import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { LeadsTable } from './leads-table';

export default async function LeadListingPage() {
  const queryClient = getQueryClient();

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LeadsTable />
    </HydrationBoundary>
  );
}
