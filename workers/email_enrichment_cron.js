// ============================================================
// workers/email_enrichment_cron.js — Cron horario que enriquece
//   leads sin email verificado.
//
// Estrategia: cada hora corre el cascade Hunter→scraping→null
// sobre un batch de leads que tengan website pero no tengan
// mega_profile.email_source ∈ ['hunter','scraped','manual'].
//
// Resultados posibles por lead:
//   - email verificado encontrado → leads.email_address actualizado
//     + mega_profile.email_source = 'hunter'|'scraped'
//   - nada encontrado → leads.outreach_status = 'NO_EMAIL'
//     (el outreach_dispatcher lo skipea automáticamente)
//
// Run modes:
//   node workers/email_enrichment_cron.js
//   node workers/email_enrichment_cron.js --self-check
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { enrichLeadEmail } from '../lib/emailEnricherCombined.js';
import { logger } from '../lib/logger.js';

const BRAND_ID    = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const BATCH_SIZE  = Number(process.env.EMAIL_ENRICH_BATCH ?? 25);
const DELAY_MS    = 1500; // rate limit entre leads (Hunter free 50/mes, no abusemos)
const SELF_CHECK  = process.argv.includes('--self-check');

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickLeadsToEnrich(supabase) {
  // Pull HOT/WARM leads with website but unverified email source.
  // - Excluye los terminales NO_EMAIL/BOUNCED/REJECTED.
  // - Incluye SENT (necesitan email verificado para futuros toques)
  //   y outreach_status=NULL (NUEVO leads sin estado todavía).
  // - Postgres .in() no matchea NULL real, por eso usamos .or() con
  //   un set de status válidos + NULL explícito.
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, business_name, website, email_address, email, mega_profile, lead_tier, outreach_status')
    .eq('brand_id', BRAND_ID)
    .not('website', 'is', null)
    .neq('website', '')
    .in('lead_tier', ['HOT', 'WARM'])
    .or('outreach_status.is.null,outreach_status.in.(PENDING,DRAFT,APPROVED,SENT,NUEVO,DRAFT_PHONE)')
    .order('lead_tier', { ascending: true })  // HOT before WARM
    .order('qualification_score', { ascending: false, nullsFirst: false })
    .limit(BATCH_SIZE * 3);  // overfetch — filter in JS

  if (error) {
    logger.error('email_enrichment_cron: fetch failed', { err: error.message });
    return [];
  }

  // JS-side filter: skip leads already verified
  const VERIFIED = new Set(['hunter', 'scraped', 'manual']);
  const candidates = (leads || []).filter((l) => {
    const src = l.mega_profile?.email_source;
    return !VERIFIED.has(src);
  }).slice(0, BATCH_SIZE);

  return candidates;
}

async function runCycle(supabase) {
  const candidates = await pickLeadsToEnrich(supabase);
  logger.info('email_enrichment_cron: cycle start', { batch_size: candidates.length });

  let enriched = 0, skipped = 0, no_email = 0, errors = 0;

  for (const lead of candidates) {
    try {
      const result = await enrichLeadEmail({ lead, supabase, log: logger });
      if (result?.email) {
        enriched++;
        logger.info('email_enrichment_cron: enriched', {
          lead_id: lead.id, business: lead.business_name,
          email: result.email, source: result.source, persona: result.persona_name,
        });
      } else {
        no_email++;
      }
    } catch (err) {
      errors++;
      logger.warn('email_enrichment_cron: lead failed', {
        lead_id: lead.id, business: lead.business_name, err: err.message,
      });
    }

    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  logger.info('email_enrichment_cron: cycle done', {
    candidates: candidates.length, enriched, no_email, skipped, errors,
  });

  return { candidates: candidates.length, enriched, no_email, skipped, errors };
}

async function main() {
  logger.info('email_enrichment_cron starting', { selfCheck: SELF_CHECK, batch_size: BATCH_SIZE });
  const supabase = buildSupabase();
  await runCycle(supabase);
  if (SELF_CHECK) {
    logger.info('email_enrichment_cron: self-check OK, exiting');
    process.exit(0);
  }
}

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('email_enrichment_cron fatal', err);
    process.exit(1);
  });
}

export { runCycle, pickLeadsToEnrich };
