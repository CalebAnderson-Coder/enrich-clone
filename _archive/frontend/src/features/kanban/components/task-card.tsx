'use client';

import { Badge } from '@/components/ui/badge';
import { KanbanItem } from '@/components/ui/kanban';

export type Lead = {
  id: string;
  business_name: string;
  industry: string;
  lead_tier: string;
  outreach_status: string;
  website: string;
  email?: string;
  phone?: string;
  created_at: string;
};

interface TaskCardProps extends Omit<React.ComponentProps<typeof KanbanItem>, 'value'> {
  task: Lead;
}

export function TaskCard({ task, ...props }: TaskCardProps) {
  return (
    <KanbanItem key={task.id} value={task.id} asChild {...props}>
      <div className='bg-card rounded-md border p-3 shadow-xs'>
        <div className='flex flex-col gap-2'>
          <div className='flex items-center justify-between gap-2'>
            <span className='line-clamp-1 text-sm font-medium'>{task.business_name}</span>
            <Badge
              variant={
                task.lead_tier === 'A'
                  ? 'destructive'
                  : task.lead_tier === 'B'
                    ? 'default'
                    : 'secondary'
              }
              className='pointer-events-none h-5 rounded-sm px-1.5 text-[11px] capitalize'
            >
              Tier {task.lead_tier || 'C'}
            </Badge>
          </div>
          <div className='text-muted-foreground flex items-center justify-between text-xs'>
            {task.industry && (
              <div className='flex items-center gap-1'>
                <span className='line-clamp-1'>{task.industry}</span>
              </div>
            )}
            {task.created_at && (
              <time className='text-[10px] tabular-nums'>
                {new Date(task.created_at).toLocaleDateString()}
              </time>
            )}
          </div>
        </div>
      </div>
    </KanbanItem>
  );
}
