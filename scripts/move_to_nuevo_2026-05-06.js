// ============================================================
// scripts/move_to_nuevo_2026-05-06.js
//
// Moves every opportunity created today (2026-05-06) by the
// outbound batch from stage CONTACTADO to stage NUEVO. The
// Empírika client (José Sánchez) flagged that "CONTACTADO" in
// his pipeline means a 1:1 personal contact (reply, call, DM)
// — cold email blasts should land in NUEVO until a human-to-
// human exchange happens.
//
// Updates:
//   1. GHL: PUT opportunities/<id> with pipelineStageId = NUEVO
//   2. Supabase: outreach_events.metadata.ghl_stage_id +
//      ghl_stage_name + stage_corrected_at + reason
//
// Idempotent — re-runs are safe (already-NUEVO opportunities just
// get the same stage written back).
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const PIPELINE_ID = 'PbSBohJh1m1L08INwMzv';
const STAGE_NUEVO = '8e718ffe-25b0-40d6-9d43-86bd0a96c5d1';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const TOKEN = process.env.GHL_PRIVATE_TOKEN || process.env.EMPIRIKA_GHL_KEY;

if (!TOKEN) {
  console.error('FATAL: GHL_PRIVATE_TOKEN missing');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
);

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Version: '2021-07-28',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

(async () => {
  const { data: rows, error } = await supabase
    .from('outreach_events')
    .select('id, lead_id, metadata')
    .eq('brand_id', BRAND_ID)
    .eq('channel', 'email')
    .eq('event_type', 'sent')
    .gte('occurred_at', '2026-05-06T12:00:00Z')
    .not('metadata->>ghl_opportunity_id', 'is', null);
  if (error) throw error;

  console.log(`\n=== Mover ${rows.length} opportunities CONTACTADO → NUEVO ===\n`);

  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    const opptyId = r.metadata.ghl_opportunity_id;
    const res = await fetch(`${GHL_BASE}/opportunities/${opptyId}`, {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify({
        pipelineId: PIPELINE_ID,
        pipelineStageId: STAGE_NUEVO,
        status: 'open',
      }),
    });

    if (res.ok) {
      const newMeta = {
        ...r.metadata,
        ghl_stage_id: STAGE_NUEVO,
        ghl_stage_name: 'NUEVO',
        stage_corrected_at: new Date().toISOString(),
        stage_correction_reason:
          'Cliente Empírika: cold-email no cuenta como CONTACTADO 1:1',
      };
      await supabase.from('outreach_events').update({ metadata: newMeta }).eq('id', r.id);
      ok++;
      process.stdout.write(`  ✓ ${opptyId}\n`);
    } else {
      fail++;
      const t = await res.text();
      console.error(`  ✗ ${opptyId} — ${res.status}: ${t.slice(0, 120)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Movidos: ${ok}`);
  console.log(`Fallos:  ${fail}`);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
