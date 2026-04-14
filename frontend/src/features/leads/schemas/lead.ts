import * as z from 'zod';

export const leadSchema = z.object({
  business_name: z.string().min(2, 'Business name must be at least 2 characters'),
  industry: z.string().min(2, 'Industry must be at least 2 characters'),
  website: z.string().url('Please enter a valid URL').or(z.literal('')),
  email: z.string().email('Please enter a valid email').optional(),
  phone: z.string().optional(),
  lead_tier: z.string().min(1, 'Please select a tier'),
  outreach_status: z.string().min(1, 'Please select a status')
});

export type LeadFormValues = z.infer<typeof leadSchema>;
