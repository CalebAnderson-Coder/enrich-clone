import { mutationOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { createLead, updateLead, deleteLead, prospectLeads } from './service';
import { leadKeys } from './queries';
import type { LeadMutationPayload } from './types';

export const createLeadMutation = mutationOptions({
  mutationFn: (data: LeadMutationPayload) => createLead(data),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: leadKeys.all });
  }
});

export const updateLeadMutation = mutationOptions({
  mutationFn: ({ id, values }: { id: string; values: LeadMutationPayload }) =>
    updateLead(id, values),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: leadKeys.all });
  }
});

export const deleteLeadMutation = mutationOptions({
  mutationFn: (id: string) => deleteLead(id),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: leadKeys.all });
  }
});

export const prospectLeadsMutation = mutationOptions({
  mutationFn: (data: { metro: string; niche: string; limit: number; autoEnrich: boolean }) => prospectLeads(data),
  onSuccess: () => {
    // We optionally invalidate queries or rely on polling/websocket for updates
    getQueryClient().invalidateQueries({ queryKey: leadKeys.all });
  }
});
