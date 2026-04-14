import { queryOptions } from '@tanstack/react-query';
import { getLeads } from './service';
import type { Lead, LeadFilters } from './types';

export type { Lead };

export const leadKeys = {
  all: ['leads'] as const,
  list: (filters: LeadFilters) => [...leadKeys.all, 'list', filters] as const,
  detail: (id: number) => [...leadKeys.all, 'detail', id] as const
};

export const leadsQueryOptions = (filters: LeadFilters) =>
  queryOptions({
    queryKey: leadKeys.list(filters),
    queryFn: () => getLeads(filters)
  });
