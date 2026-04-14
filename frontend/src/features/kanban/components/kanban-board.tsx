'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Kanban, KanbanBoard as KanbanBoardPrimitive, KanbanOverlay } from '@/components/ui/kanban';
import { TaskColumn } from './board-column';
import { TaskCard, type Lead } from './task-card';
import { createRestrictToContainer } from '../utils/restrict-to-container';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const COLUMNS = [
  'PENDING',
  'CONTACTED',
  'RESPONDED',
  'MEETING_SET',
  'CLOSED',
  'NURTURING',
  'DEAD'
];

export function KanbanBoard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: leads } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const res = await fetch('/api/leads?limit=1000');
      if (!res.ok) throw new Error('Failed to fetch leads');
      const data = await res.json();
      return (Array.isArray(data) ? data : data.leads || data.data || []) as Lead[];
    }
  });

  const [columns, setColumns] = useState<Record<string, Lead[]>>(() => {
    const defaultCols: Record<string, Lead[]> = {};
    for (const c of COLUMNS) defaultCols[c] = [];
    return defaultCols;
  });

  useEffect(() => {
    if (!leads) return;
    
    // Only update columns fully if we don't have ongoing drags,
    // though here we just do a full sync. In a real app we might diff.
    const newColumns: Record<string, Lead[]> = {};
    for (const c of COLUMNS) newColumns[c] = [];

    leads.forEach((lead: Lead) => {
      const status = lead.outreach_status?.toUpperCase() || 'PENDING';
      if (newColumns[status]) {
        newColumns[status].push(lead);
      } else {
        newColumns.PENDING.push(lead);
      }
    });
    setColumns(newColumns);
  }, [leads]);

  const updateOutreachMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/leads/${id}/outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Failed to update outreach status');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    }
  });

  const handleValueChange = (newColumns: Record<string, Lead[]>) => {
    // Find what changed
    let movedLeadId: string | null = null;
    let newStatus: string | null = null;

    for (const [status, statusLeads] of Object.entries(newColumns)) {
      const oldStatusLeads = columns[status] || [];
      if (statusLeads.length > oldStatusLeads.length) {
        // This column gained a lead! Let's find which one
        for (const lead of statusLeads) {
          if (!oldStatusLeads.find(l => l.id === lead.id)) {
            movedLeadId = lead.id;
            newStatus = status;
            break;
          }
        }
      }
      if (movedLeadId) break;
    }

    setColumns(newColumns);

    if (movedLeadId && newStatus) {
      updateOutreachMutation.mutate({ id: movedLeadId, status: newStatus });
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- factory function, stable after mount
  const restrictToBoard = useCallback(
    createRestrictToContainer(() => containerRef.current),
    []
  );

  return (
    <div ref={containerRef}>
      <Kanban
        value={columns}
        onValueChange={handleValueChange}
        getItemValue={(item) => item.id}
        modifiers={[restrictToBoard]}
        autoScroll={false}
      >
        <ScrollArea className='w-full rounded-md pb-4'>
          <KanbanBoardPrimitive className='flex items-start'>
            {Object.entries(columns).map(([columnValue, tasks]) => (
              <TaskColumn key={columnValue} value={columnValue} tasks={tasks} />
            ))}
          </KanbanBoardPrimitive>
          <ScrollBar orientation='horizontal' />
        </ScrollArea>
        <KanbanOverlay>
          {({ value, variant }) => {
            if (variant === 'column') {
              const tasks = columns[value] ?? [];
              return <TaskColumn value={value} tasks={tasks} />;
            }

            const task = Object.values(columns)
              .flat()
              .find((task) => task.id === value);

            if (!task) return null;
            return <TaskCard task={task} />;
          }}
        </KanbanOverlay>
      </Kanban>
    </div>
  );
}
