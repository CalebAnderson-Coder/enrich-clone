import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KanbanBoard } from '../kanban-board';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import type { Lead } from '../task-card';

// Mock dnd-kit components since they require DOM measurements
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({ children }: any) => <div>{children}</div>,
    useDndContext: () => ({ active: null, over: null }),
    DragOverlay: () => null,
    closestCorners: () => null,
  };
});

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual('@dnd-kit/sortable');
  return {
    ...actual,
    SortableContext: ({ children }: any) => <div>{children}</div>,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      setDroppableNodeRef: vi.fn(),
      transform: null,
      transition: null,
      isDragging: false,
    }),
  };
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn().mockReturnValue({ mutate: vi.fn() }),
  };
});

describe('KanbanBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders successfully in a loading state without causing infinite re-renders', () => {
    // If the component has the infinite update loop bug, this test would crash the runner
    // or fail due to exceeding the maximum update depth.
    vi.mocked(ReactQuery.useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(
      <QueryClientProvider client={queryClient}>
        <KanbanBoard />
      </QueryClientProvider>
    );

    // Should default to rendering the empty columns
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Contacted')).toBeInTheDocument();
  });

  it('correctly maps leads to columns when data loads', () => {
    const mockLeads: Lead[] = [
      {
        id: '1',
        business_name: 'Acme Corp',
        industry: 'Tech',
        lead_tier: 'A',
        outreach_status: 'PENDING',
        website: 'acme.com',
        created_at: new Date().toISOString(),
      },
      {
        id: '2',
        business_name: 'Globex',
        industry: 'Logistics',
        lead_tier: 'B',
        outreach_status: 'CONTACTED',
        website: 'globex.com',
        created_at: new Date().toISOString(),
      },
    ];

    vi.mocked(ReactQuery.useQuery).mockReturnValue({
      data: mockLeads,
      isLoading: false,
      error: null,
    } as any);

    render(
      <QueryClientProvider client={queryClient}>
        <KanbanBoard />
      </QueryClientProvider>
    );

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
  });
});
