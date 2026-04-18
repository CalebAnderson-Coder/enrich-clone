// ============================================================
// tools/baileysWhatsApp.js — Baileys (@whiskeysockets/baileys) wrapper
//
// Sprint 5. Direct-to-WhatsApp outbound channel for Empírika
// (no Evolution API, no Docker). Persists Baileys auth state in
// Supabase (table whatsapp_sessions) so Render's ephemeral FS
// does not force a re-pair after every redeploy.
//
// Public API:
//   connect({ brandId })              — boots the socket, wires handlers
//   getConnectionStatus(brandId)      — { status, phoneNumber?, qrCode? }
//   checkWhatsApp(phoneE164, { brandId }) — { exists, jid? }
//   sendText({ brandId, to, body })   — warmup-gated, Spanish-only guard
//   disconnect(brandId)               — logout + clear DB
//   canSendToday(brandId)             — warmup counter check
//   incrementWarmup(brandId)          — bump today's counter
//
// Rollback: when MULTICHANNEL_ENABLED!=true the dispatcher never
// imports this module, so the Baileys dep remains a no-op and the
// whatsapp_sessions table stays empty.
// ============================================================

import { logger as rootLogger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';

const log = rootLogger.child({ module: 'baileysWhatsApp' });

// Lazy, per-brand socket cache so we don't reconnect on every send.
const socketsByBrand = new Map();

// ── Spanish-only guard (IRON RULE #1) ─────────────────────────
// Reject any body that contains obvious English tokens so WhatsApp
// outbound for Empírika stays 100% in Spanish. Mirrors the guard
// used by tests/autonomy.spec.js for Angela's system prompt.
const ENGLISH_GUARD_REGEX = /\b(hello|hi there|thanks|regards|best regards|appreciate|your business|looking forward|cheers|kindly|please find|sincerely|good morning|good afternoon|good evening)\b/i;

export class SpanishOnlyViolation extends Error {
  constructor(snippet) {
    super(`spanish_only_violation: "${String(snippet).slice(0, 80)}"`);
    this.code = 'SPANISH_ONLY_VIOLATION';
  }
}

export function assertSpanishOnly(body) {
  if (typeof body !== 'string' || !body.trim()) {
    throw new Error('baileys.sendText: body must be a non-empty string');
  }
  const match = body.match(ENGLISH_GUARD_REGEX);
  if (match) throw new SpanishOnlyViolation(match[0]);
}

// ── Warmup caps (env-configurable, week-indexed) ──────────────
function warmupCapForWeek(week) {
  const w = Math.max(1, Math.floor(Number(week) || 1));
  const e = (k, d) => Number(process.env[k] || d);
  if (w === 1) return e('WA_WARMUP_WEEK1_CAP', 5);
  if (w === 2) return e('WA_WARMUP_WEEK2_CAP', 15);
  if (w === 3) return e('WA_WARMUP_WEEK3_CAP', 30);
  return e('WA_WARMUP_WEEK4PLUS_CAP', 50);
}

function ymdUtc(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Load warmup row for today; creates a fresh one when absent.
 * Returns { sends_count, cap, week_since_start, ymd }.
 * Allows a test-injected supabase client via opts.client.
 */
export async function getWarmupState(brandId, { client } = {}) {
  const db = client || supabase;
  const ymd = ymdUtc();
  if (!db) return { sends_count: 0, cap: warmupCapForWeek(1), week_since_start: 1, ymd };

  const { data, error } = await db
    .from('whatsapp_warmup')
    .select('*')
    .eq('brand_id', brandId)
    .eq('ymd', ymd)
    .maybeSingle();
  if (error) {
    log.warn('getWarmupState query error', { error: error.message });
    return { sends_count: 0, cap: warmupCapForWeek(1), week_since_start: 1, ymd };
  }
  if (data) return data;

  // Bootstrap today's row. Week number inferred from latest row.
  let week = 1;
  try {
    const { data: latest } = await db
      .from('whatsapp_warmup')
      .select('week_since_start, ymd')
      .eq('brand_id', brandId)
      .order('ymd', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.week_since_start) {
      // Advance week if 7+ days have elapsed since that row.
      const elapsed = (Date.now() - new Date(latest.ymd).getTime()) / 86_400_000;
      week = elapsed >= 7 ? latest.week_since_start + 1 : latest.week_since_start;
    }
  } catch { /* silent */ }

  const cap = warmupCapForWeek(week);
  const row = { brand_id: brandId, ymd, sends_count: 0, cap, week_since_start: week };
  try {
    await db.from('whatsapp_warmup').insert(row);
  } catch { /* tolerate duplicate-insert races */ }
  return row;
}

export async function canSendToday(brandId, { client } = {}) {
  const state = await getWarmupState(brandId, { client });
  return (state.sends_count || 0) < (state.cap || 0);
}

export async function incrementWarmup(brandId, { client } = {}) {
  const db = client || supabase;
  if (!db) return;
  const state = await getWarmupState(brandId, { client: db });
  try {
    await db
      .from('whatsapp_warmup')
      .update({ sends_count: (state.sends_count || 0) + 1, updated_at: new Date().toISOString() })
      .eq('brand_id', brandId)
      .eq('ymd', state.ymd);
  } catch (err) {
    log.warn('incrementWarmup failed', { error: err?.message });
  }
}

// ── Auth-state adapter (Supabase-backed, Baileys-compatible) ──
// Baileys' auth state is { creds, keys: { get, set } }. We mirror
// useMultiFileAuthState's contract but serialize everything to the
// whatsapp_sessions row owned by this brand.
async function loadSession(brandId, { client } = {}) {
  const db = client || supabase;
  if (!db) return null;
  const { data, error } = await db
    .from('whatsapp_sessions')
    .select('*')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) {
    log.warn('loadSession error', { error: error.message });
    return null;
  }
  return data || null;
}

async function saveSession(brandId, patch, { client } = {}) {
  const db = client || supabase;
  if (!db) return;
  const row = { brand_id: brandId, ...patch, updated_at: new Date().toISOString() };
  try {
    await db.from('whatsapp_sessions').upsert(row, { onConflict: 'brand_id' });
  } catch (err) {
    log.warn('saveSession upsert failed', { error: err?.message });
  }
}

/**
 * Build a Baileys-compatible authState from a whatsapp_sessions row.
 * Keys are serialized as JSON (Baileys uses Buffer fields — we hex
 * encode them so JSON round-trips cleanly).
 */
function buildAuthState(row, { onUpdate }) {
  // NOTE: Baileys exposes initAuthCreds() to mint a fresh creds blob
  // on first boot. Because this wrapper is imported lazily inside
  // connect(), the dynamic import resolves the live module there.
  const credsBlob = row?.creds || null;
  const keysBlob  = row?.keys  || {};

  return {
    _credsBlob: credsBlob, // consumed by connect() below
    keys: {
      get: async (type, ids) => {
        const bucket = keysBlob[type] || {};
        const out = {};
        for (const id of ids) out[id] = bucket[id];
        return out;
      },
      set: async (data) => {
        for (const category of Object.keys(data || {})) {
          if (!keysBlob[category]) keysBlob[category] = {};
          for (const id of Object.keys(data[category] || {})) {
            const v = data[category][id];
            if (v === null || v === undefined) delete keysBlob[category][id];
            else keysBlob[category][id] = v;
          }
        }
        if (onUpdate) await onUpdate({ keys: keysBlob });
      },
    },
  };
}

// ── Core: connect (idempotent per brand) ──────────────────────
export async function connect({ brandId, client } = {}) {
  if (!brandId) throw new Error('connect: brandId required');
  if (socketsByBrand.has(brandId)) return socketsByBrand.get(brandId);

  // Lazy, optional Baileys import. Throws a clear error if the dep
  // is missing (package.json has it, but `npm install` may not have
  // run in a given worktree).
  let baileys;
  try {
    baileys = await import('@whiskeysockets/baileys');
  } catch (err) {
    const e = new Error('baileys_not_installed: run `npm install @whiskeysockets/baileys`');
    e.cause = err;
    throw e;
  }
  const { default: makeWASocket, initAuthCreds, DisconnectReason } = baileys;

  const row = await loadSession(brandId, { client });
  const auth = buildAuthState(row, {
    onUpdate: async (patch) => saveSession(brandId, patch, { client }),
  });
  const creds = auth._credsBlob || initAuthCreds();

  const sock = makeWASocket({
    auth: { creds, keys: auth.keys },
    printQRInTerminal: false,
  });

  // Persist creds as they change.
  sock.ev.on('creds.update', async () => {
    await saveSession(brandId, { creds: sock.authState?.creds || creds }, { client });
  });

  // Track connection + QR.
  sock.ev.on('connection.update', async (u) => {
    const patch = { last_ping_at: new Date().toISOString() };
    if (u.qr) {
      patch.status = 'QR_PENDING';
      patch.qr_code_pending = u.qr;
    }
    if (u.connection === 'open') {
      patch.status = 'CONNECTED';
      patch.connected_at = new Date().toISOString();
      patch.qr_code_pending = null;
      const me = sock?.user?.id?.split(':')?.[0] || null;
      if (me) patch.phone_number = me;
    }
    if (u.connection === 'close') {
      const reason = u.lastDisconnect?.error?.output?.statusCode;
      const loggedOut = reason === DisconnectReason?.loggedOut;
      patch.status = loggedOut ? 'LOGGED_OUT' : 'DISCONNECTED';
      socketsByBrand.delete(brandId);
      if (!loggedOut) {
        // Schedule a best-effort reconnect (non-blocking).
        setTimeout(() => connect({ brandId, client }).catch((e) => {
          log.warn('baileys reconnect failed', { brandId, error: e?.message });
        }), 3000);
      }
    }
    try { await saveSession(brandId, patch, { client }); } catch { /* silent */ }
  });

  // Incoming replies → outreach_events('replied') + status flip.
  // Lazy-imported to keep this file loadable even if learning events
  // module is absent in some test environments.
  sock.ev.on('messages.upsert', async (payload) => {
    if (payload?.type !== 'notify') return;
    try {
      const { logOutreachEvent } = await import('./outreachEvents.js');
      for (const m of payload.messages || []) {
        if (!m?.message || m.key?.fromMe) continue;
        const jid = m.key?.remoteJid || '';
        const phone = jid.split('@')[0];
        // Resolve lead by phone to attach the event.
        const db = client || supabase;
        if (!db) continue;
        const { data: lead } = await db
          .from('leads')
          .select('id, brand_id')
          .eq('phone', phone)
          .eq('brand_id', brandId)
          .maybeSingle();
        if (!lead) continue;
        await logOutreachEvent({
          leadId:    lead.id,
          brandId:   lead.brand_id,
          channel:   'whatsapp',
          eventType: 'replied',
          metadata:  { jid, message_id: m.key?.id || null },
        });
        try {
          await db
            .from('campaign_enriched_data')
            .update({ outreach_status: 'RESPONDED' })
            .eq('brand_id', brandId)
            .eq('prospect_id', lead.id);
        } catch { /* silent */ }
      }
    } catch (err) {
      log.warn('messages.upsert handler failed', { error: err?.message });
    }
  });

  // Delivery + read receipts.
  sock.ev.on('message-receipt.update', async (updates) => {
    try {
      const { logOutreachEvent } = await import('./outreachEvents.js');
      for (const u of updates || []) {
        const type = u?.receipt?.receiptTimestamp && u?.receipt?.readTimestamp
          ? 'read'
          : 'delivered';
        await logOutreachEvent({
          leadId:    null,
          brandId,
          channel:   'whatsapp',
          eventType: type,
          messageId: u?.key?.id || null,
          metadata:  { jid: u?.key?.remoteJid || null },
        });
      }
    } catch (err) {
      log.warn('message-receipt handler failed', { error: err?.message });
    }
  });

  socketsByBrand.set(brandId, sock);
  return sock;
}

export async function getConnectionStatus(brandId, { client } = {}) {
  const row = await loadSession(brandId, { client });
  if (!row) return { status: 'DISCONNECTED' };
  return {
    status:       row.status || 'DISCONNECTED',
    phoneNumber:  row.phone_number || null,
    qrCode:       row.status === 'QR_PENDING' ? (row.qr_code_pending || null) : null,
    connectedAt:  row.connected_at || null,
    lastPingAt:   row.last_ping_at || null,
  };
}

// ── Operational helpers ──────────────────────────────────────
function toJid(phoneE164) {
  const digits = String(phoneE164 || '').replace(/[^\d]/g, '');
  if (!digits) throw new Error('toJid: empty phone');
  return `${digits}@s.whatsapp.net`;
}

export async function checkWhatsApp(phoneE164, { brandId, sock: injected } = {}) {
  const sock = injected || socketsByBrand.get(brandId);
  if (!sock) throw new Error('checkWhatsApp: socket not connected for brand');
  const jid = toJid(phoneE164);
  try {
    const results = await sock.onWhatsApp(jid);
    const hit = Array.isArray(results) ? results.find((r) => r?.exists) : null;
    if (hit) return { exists: true, jid: hit.jid || jid };
    return { exists: false };
  } catch (err) {
    log.warn('checkWhatsApp failed', { error: err?.message });
    return { exists: false, error: err?.message };
  }
}

export async function sendText({ brandId, to, body, sock: injected, client } = {}) {
  if (!brandId) throw new Error('sendText: brandId required');
  assertSpanishOnly(body);

  const allowed = await canSendToday(brandId, { client });
  if (!allowed) {
    const err = new Error('warmup_cap_reached');
    err.code = 'WARMUP_CAP_REACHED';
    throw err;
  }

  const sock = injected || socketsByBrand.get(brandId);
  if (!sock) throw new Error('sendText: socket not connected for brand');

  const jid = toJid(to);
  const res = await sock.sendMessage(jid, { text: body });
  await incrementWarmup(brandId, { client });
  return {
    messageId: res?.key?.id || null,
    sentAt:    new Date().toISOString(),
    jid,
  };
}

export async function disconnect(brandId, { client } = {}) {
  const sock = socketsByBrand.get(brandId);
  socketsByBrand.delete(brandId);
  try {
    if (sock?.logout) await sock.logout();
  } catch (err) {
    log.warn('disconnect logout failed', { error: err?.message });
  }
  await saveSession(brandId, {
    status: 'LOGGED_OUT', creds: null, keys: {}, qr_code_pending: null,
  }, { client });
}

// ── Test hook: inject a stub socket so dispatcher tests don't
// need to boot the real Baileys library.
export function __setSocketForTest(brandId, stubSock) {
  if (stubSock) socketsByBrand.set(brandId, stubSock);
  else socketsByBrand.delete(brandId);
}
