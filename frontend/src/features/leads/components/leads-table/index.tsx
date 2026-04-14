'use client';

import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { useQuery } from '@tanstack/react-query';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { getSortingStateParser } from '@/lib/parsers';
import { leadsQueryOptions } from '../../api/queries';
import { columns } from './columns';
import { LeadGrid } from '../lead-grid';
import React, { useState } from 'react';

const columnIds = columns.map((c) => c.id).filter(Boolean) as string[];

export function LeadsTable() {
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  const [params] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(100),
    name: parseAsString,
    status: parseAsString,
    sort: getSortingStateParser(columnIds).withDefault([])
  });

  const filters = {
    page: params.page,
    limit: params.perPage,
    ...(params.name && { search: params.name }),
    ...(params.status && { status: params.status }),
    ...(params.sort.length > 0 && { sort: JSON.stringify(params.sort) })
  };

  const { data, isPending, error } = useQuery(leadsQueryOptions(filters));

  const leadsData = data?.leads ?? [];
  const pageCount = Math.ceil((data?.total_leads ?? 0) / params.perPage);

  const { table } = useDataTable({
    data: leadsData,
    columns,
    pageCount,
    shallow: true,
    debounceMs: 500,
    initialState: {
      columnPinning: { right: ['actions'] }
    }
  });

  if (isPending) return <LeadsTableSkeleton />;
  if (error || !data) return <div>Error loading leads.</div>;

  return (
    <div>
      {/* View Toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          padding: '0 4px',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>
          Leads ({leadsData.length})
        </h2>
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 3,
            background: 'rgba(30,41,59,0.6)',
            borderRadius: 8,
            border: '1px solid rgba(148,163,184,0.1)',
          }}
        >
          <button
            onClick={() => setViewMode('cards')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              background: viewMode === 'cards' ? 'rgba(59,130,246,0.2)' : 'transparent',
              color: viewMode === 'cards' ? '#60a5fa' : '#64748b',
              transition: 'all 0.2s ease',
            }}
          >
            🃏 Tarjetas
          </button>
          <button
            onClick={() => setViewMode('table')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              background: viewMode === 'table' ? 'rgba(59,130,246,0.2)' : 'transparent',
              color: viewMode === 'table' ? '#60a5fa' : '#64748b',
              transition: 'all 0.2s ease',
            }}
          >
            📊 Tabla
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'cards' ? (
        <LeadGrid leads={leadsData} />
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}
    </div>
  );
}

export function LeadsTableSkeleton() {
  return (
    <div className='flex flex-1 animate-pulse flex-col gap-4'>
      <div className='bg-muted h-10 w-full rounded' />
      <div className='bg-muted h-96 w-full rounded-lg' />
      <div className='bg-muted h-10 w-full rounded' />
    </div>
  );
}
