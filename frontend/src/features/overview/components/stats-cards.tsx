// @ts-nocheck
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { IconMapPin, IconFlame } from '@tabler/icons-react';

interface LeadStats {
  byTier: Record<string, number>;
  byMetro: Record<string, number>;
  byIndustry: Record<string, number>;
}

export function StatsCards() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['lead-stats'],
    queryFn: () => apiClient<LeadStats>('/leads/stats')
  });

  if (isLoading) {
    return (
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className='h-[160px] w-full rounded-xl' />
        ))}
      </div>
    );
  }

  const statsData = stats?.data || stats?.stats || stats || {};
  const byTier = statsData.byTier || {};
  const byMetro = statsData.byMetro || {};

  const totalLeads = Object.values(byTier).reduce((a, b) => a + Number(b), 0);
  const hotLeads = byTier['HOT'] || 0;
  const warmLeads = byTier['WARM'] || 0;
  const activeMarkets = Object.keys(byMetro).length;

  return (
    <div className='*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs md:grid-cols-2 lg:grid-cols-4'>
      <Card className='@container/card'>
        <CardHeader>
          <CardDescription>Total Leads</CardDescription>
          <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
            {totalLeads.toLocaleString()}
          </CardTitle>
          <CardAction>
            <Badge variant='outline'>
              <Icons.trendingUp />
              Lead Vol
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className='flex-col items-start gap-1.5 text-sm'>
          <div className='line-clamp-1 flex gap-2 font-medium'>
            Total leads in database <Icons.trendingUp className='size-4' />
          </div>
          <div className='text-muted-foreground'>Combined across all tiers</div>
        </CardFooter>
      </Card>
      
      <Card className='@container/card'>
        <CardHeader>
          <CardDescription>Hot Leads</CardDescription>
          <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
            {hotLeads.toLocaleString()}
          </CardTitle>
          <CardAction>
            <Badge variant='outline'>
              <IconFlame className="size-4 text-orange-500" />
              High Priority
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className='flex-col items-start gap-1.5 text-sm'>
          <div className='line-clamp-1 flex gap-2 font-medium'>
            Ready for outreach <IconFlame className='size-4 text-orange-500' />
          </div>
          <div className='text-muted-foreground'>Needs immediate attention</div>
        </CardFooter>
      </Card>
      
      <Card className='@container/card'>
        <CardHeader>
          <CardDescription>Warm Leads</CardDescription>
          <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
            {warmLeads.toLocaleString()}
          </CardTitle>
          <CardAction>
            <Badge variant='outline'>
              <Icons.sun className="size-4 text-yellow-500" />
              Nurturing
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className='flex-col items-start gap-1.5 text-sm'>
          <div className='line-clamp-1 flex gap-2 font-medium'>
            Developing interest <Icons.sun className='size-4 text-yellow-500' />
          </div>
          <div className='text-muted-foreground'>Prequalified prospects</div>
        </CardFooter>
      </Card>
      
      <Card className='@container/card'>
        <CardHeader>
          <CardDescription>Active Markets</CardDescription>
          <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
            {activeMarkets.toLocaleString()}
          </CardTitle>
          <CardAction>
            <Badge variant='outline'>
              <IconMapPin className="size-4 text-blue-500" />
              Regions
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className='flex-col items-start gap-1.5 text-sm'>
          <div className='line-clamp-1 flex gap-2 font-medium'>
            Metro areas covered <IconMapPin className='size-4 text-blue-500' />
          </div>
          <div className='text-muted-foreground'>Geographic distribution</div>
        </CardFooter>
      </Card>
    </div>
  );
}
