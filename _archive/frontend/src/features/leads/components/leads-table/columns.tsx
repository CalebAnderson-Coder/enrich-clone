'use client';
import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import type { Lead } from '../../api/types';
import { Column, ColumnDef } from '@tanstack/react-table';
import { Icons } from '@/components/icons';
import { CellAction } from './cell-action';
import { STATUS_OPTIONS, TIER_OPTIONS } from './options';

export const columns: ColumnDef<Lead>[] = [
  {
    id: 'name',
    accessorFn: (row) => row.business_name,
    header: ({ column }: { column: Column<Lead, unknown> }) => (
      <DataTableColumnHeader column={column} title='Business Name' />
    ),
    cell: ({ row }) => (
      <div className='flex flex-col'>
        <span className='font-medium'>{row.original.business_name}</span>
        <span className='text-muted-foreground text-xs line-clamp-1'>
          {row.original.website}
        </span>
      </div>
    ),
    meta: {
      label: 'Business',
      placeholder: 'Search leads...',
      variant: 'text' as const,
      icon: Icons.text
    },
    enableColumnFilter: true
  },
  {
    accessorKey: 'industry',
    header: 'INDUSTRY'
  },
  {
    accessorKey: 'lead_tier',
    header: 'TIER',
    cell: ({ cell }) => {
      const tier = cell.getValue<string>()?.toUpperCase();
      const variantMap: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
        'HOT': 'destructive',
        'WARM': 'default',
        'COOL': 'secondary',
        'COLD': 'outline'
      };
      return (
        <Badge variant={variantMap[tier] || 'secondary'}>
          {tier || 'COLD'}
        </Badge>
      );
    },
    enableColumnFilter: true,
    meta: {
      label: 'tier',
      variant: 'multiSelect' as const,
      options: TIER_OPTIONS
    }
  },
  {
    id: 'outreach_status',
    accessorKey: 'outreach_status',
    enableSorting: false,
    header: ({ column }: { column: Column<Lead, unknown> }) => (
      <DataTableColumnHeader column={column} title='Status' />
    ),
    cell: ({ cell }) => {
      const status = cell.getValue<string>();
      return (
        <Badge variant='outline' className='capitalize'>
          {status}
        </Badge>
      );
    },
    enableColumnFilter: true,
    meta: {
      label: 'status',
      variant: 'multiSelect' as const,
      options: STATUS_OPTIONS
    }
  },
  {
    id: 'actions',
    cell: ({ row }) => <CellAction data={row.original} />
  }
];
