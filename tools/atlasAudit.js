// ============================================================
// tools/atlasAudit.js — Tool wrapper for Atlas's audit pass
//
// Lets the rest of the fleet invoke Atlas via the standard
// tool-calling protocol. The actual audit lives in
// lib/atlasAudit.js and is deterministic.
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import { createClient } from '@supabase/supabase-js';
import { runAtlasAudit } from '../lib/atlasAudit.js';

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

export const atlasAuditTool = new Tool({
  name: 'audit_fleet_health',
  description: 'Corre una auditoría completa del fleet (heartbeats, mensajes atascados, errores recientes, circuit breakers) y devuelve verdicto HEALTHY/DEGRADED/CRITICAL con findings detallados. Si CRITICAL, alerta a Manager automáticamente. Pure SQL, sin LLM.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  fn: async (_args, context = {}) => {
    const brandId = context.brand_id || process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
    const supabase = context.supabase || buildSupabase();
    const messenger = context.messenger || null;
    const log = context.log || null;
    try {
      const out = await runAtlasAudit({ supabase, brandId, messenger, log });
      return JSON.stringify(out);
    } catch (err) {
      return JSON.stringify({
        status: 'CRITICAL',
        alive_count: 0,
        stale_count: 0,
        crashed_count: 0,
        stuck_messages: 0,
        failed_1h: 0,
        findings: [{ kind: 'audit_failure', detail: `Atlas tool threw: ${err.message}`, severity: 'critical' }],
        metrics: {},
        alerted: false,
        audit_id: null,
      });
    }
  },
});
