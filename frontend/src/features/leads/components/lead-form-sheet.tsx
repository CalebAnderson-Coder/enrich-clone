'use client';

import { useState } from 'react';
import { useAppForm, useFormFields } from '@/components/ui/tanstack-form';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Icons } from '@/components/icons';
import { useMutation } from '@tanstack/react-query';
import { createLeadMutation, updateLeadMutation } from '../api/mutations';
import type { Lead } from '../api/types';
import { toast } from 'sonner';
import * as z from 'zod';
import { leadSchema, type LeadFormValues } from '../schemas/lead';
import { STATUS_OPTIONS } from './leads-table/options';

const TIER_OPTIONS = [
  { value: 'A', label: 'Tier A' },
  { value: 'B', label: 'Tier B' },
  { value: 'C', label: 'Tier C' }
];

interface LeadFormSheetProps {
  lead?: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadFormSheet({ lead, open, onOpenChange }: LeadFormSheetProps) {
  const isEdit = !!lead;

  const createMutation = useMutation({
    ...createLeadMutation,
    onSuccess: () => {
      toast.success('Lead created successfully');
      onOpenChange(false);
      form.reset();
    },
    onError: () => toast.error('Failed to create lead')
  });

  const updateMutation = useMutation({
    ...updateLeadMutation,
    onSuccess: () => {
      toast.success('Lead updated successfully');
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to update lead')
  });

  const form = useAppForm({
    defaultValues: {
      business_name: lead?.business_name ?? '',
      industry: lead?.industry ?? '',
      website: lead?.website ?? '',
      email: lead?.email ?? '',
      phone: lead?.phone ?? '',
      lead_tier: lead?.lead_tier ?? 'C',
      outreach_status: lead?.outreach_status ?? 'uncontacted'
    } as LeadFormValues,
    validators: {
      onSubmit: leadSchema
    },
    onSubmit: async ({ value }) => {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: lead.id, values: value });
      } else {
        await createMutation.mutateAsync(value);
      }
    }
  });

  const { FormTextField, FormSelectField } = useFormFields<LeadFormValues>();

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='flex flex-col'>
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Lead' : 'New Lead'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'Update the lead details below.'
              : 'Fill in the details to create a new lead.'}
          </SheetDescription>
        </SheetHeader>

        <div className='flex-1 overflow-auto'>
          <form.AppForm>
            <form.Form id='lead-form-sheet' className='space-y-4 pt-4'>
              <FormTextField
                name='business_name'
                label='Business Name'
                required
                placeholder='Acme Corp'
              />
              
              <FormTextField
                name='industry'
                label='Industry'
                required
                placeholder='Technology'
              />

              <FormTextField
                name='website'
                label='Website'
                type='url'
                placeholder='https://acme.com'
              />

              <div className='grid grid-cols-2 gap-4'>
                <FormTextField
                  name='email'
                  label='Email'
                  type='email'
                  placeholder='contact@acme.com'
                />

                <FormTextField
                  name='phone'
                  label='Phone'
                  type='tel'
                  placeholder='(555) 123-4567'
                />
              </div>

              <FormSelectField
                name='lead_tier'
                label='Lead Tier'
                required
                options={TIER_OPTIONS}
                placeholder='Select tier'
              />

              <FormSelectField
                name='outreach_status'
                label='Status'
                required
                options={STATUS_OPTIONS}
                placeholder='Select status'
              />
            </form.Form>
          </form.AppForm>
        </div>

        <SheetFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type='submit' form='lead-form-sheet' isLoading={isPending}>
            <Icons.check /> {isEdit ? 'Update Lead' : 'Create Lead'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function LeadFormSheetTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Icons.add className='mr-2 h-4 w-4' /> Add Lead
      </Button>
      <LeadFormSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
