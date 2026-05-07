import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabaseAuth } from '../lib/supabaseAuthClient';
import { AGENT_ORDER, getAgentMetaByDbName } from '../components/LiveAgentsFloor/agentMeta';
import AgentHeartbeatCard from '../components/HeartbeatWall/AgentHeartbeatCard';
import AgentDetailModal from '../components/LiveAgentsFloor/AgentDetailModal';

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const TICK_MS = 5000;

// Dedupe rows: most-recent per agent_name (rows already ordered DESC by last_heartbeat_at)
function dedupeByAgentName(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = row.agent_name?.toLowerCase().replace(/\s+empirika$/i, '').trim();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(row);
    }
  }
  return result;
}

// Map a db row's agent_name to the canonical AGENT_ORDER key
function toOrderKey(dbName) {
  return dbName?.toLowerCase().replace(/\s+empirika$/i, '').trim() ?? '';
}

// Build a stats map keyed by normalized agent name: { emailsToday, messagesToday }
function buildStatsMap(outreachRows, messageRows) {
  const map = {};

  for (const row of outreachRows) {
    const agentRaw = row.metadata?.agent ?? '';
    const key = agentRaw.toLowerCase().replace(/\s+empirika$/i, '').trim();
    if (!key) continue;
    if (!map[key]) map[key] = { emailsToday: 0, messagesToday: 0 };
    map[key].emailsToday += 1;
  }

  for (const row of messageRows) {
    const agents = [row.from_agent, row.to_agent].filter(Boolean);
    for (const a of agents) {
      const key = a.toLowerCase().replace(/\s+empirika$/i, '').trim();
      if (!map[key]) map[key] = { emailsToday: 0, messagesToday: 0 };
      map[key].messagesToday += 1;
    }
  }

  return map;
}

// ───────────────────────────────────────────────
// Container animation
// ───────────────────────────────────────────────
const GRID_VARIANTS = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

export default function HeartbeatWallView() {
  // processRowByKey[agentOrderKey] = most-recent process row
  const [processRowByKey, setProcessRowByKey] = useState({});
  const [statsMap, setStatsMap] = useState({});
  const [nowMs, setNowMs] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  // AgentDetailModal — it expects agentId (order key) + events[]
  const [selectedAgentId, setSelectedAgentId] = useState(null);

  const realtimeChannelRef = useRef(null);

  // ── Merge a new/updated process row into state ──
  const mergeRow = useCallback((row) => {
    const key = toOrderKey(row.agent_name);
    if (!key) return;
    setProcessRowByKey((prev) => {
      const existing = prev[key];
      // Only replace if this row is newer
      if (
        existing &&
        new Date(existing.last_heartbeat_at) >= new Date(row.last_heartbeat_at)
      ) {
        return prev;
      }
      return { ...prev, [key]: row };
    });
  }, []);

  // ── Initial load ──
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 1. agent_processes — all rows for brand, sorted newest first
        const { data: procRows, error: procErr } = await supabaseAuth
          .from('agent_processes')
          .select('agent_name, brand_id, process_id, host, started_at, last_heartbeat_at, status, metadata')
          .eq('brand_id', BRAND_ID)
          .order('last_heartbeat_at', { ascending: false });

        if (procErr) console.error('[HeartbeatWall] agent_processes error:', procErr);

        const dedupedRows = dedupeByAgentName(procRows ?? []);
        const byKey = {};
        for (const row of dedupedRows) {
          const key = toOrderKey(row.agent_name);
          if (key) byKey[key] = row;
        }
        if (!cancelled) setProcessRowByKey(byKey);

        // 2. Stats — today's outreach emails
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayIso = todayStart.toISOString();

        const { data: outreachRows } = await supabaseAuth
          .from('outreach_events')
          .select('metadata')
          .eq('brand_id', BRAND_ID)
          .eq('channel', 'email')
          .eq('event_type', 'sent')
          .gte('occurred_at', todayIso);

        // 3. Stats — today's agent messages
        const { data: msgRows } = await supabaseAuth
          .from('agent_messages')
          .select('from_agent, to_agent')
          .eq('brand_id', BRAND_ID)
          .gte('created_at', todayIso);

        if (!cancelled) {
          setStatsMap(buildStatsMap(outreachRows ?? [], msgRows ?? []));
          setLoading(false);
        }
      } catch (err) {
        console.error('[HeartbeatWall] load error:', err);
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Realtime subscription ──
  useEffect(() => {
    const channel = supabaseAuth
      .channel('heartbeat-wall-processes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_processes',
          filter: `brand_id=eq.${BRAND_ID}`,
        },
        (payload) => mergeRow(payload.new)
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_processes',
          filter: `brand_id=eq.${BRAND_ID}`,
        },
        (payload) => mergeRow(payload.new)
      )
      .subscribe();

    realtimeChannelRef.current = channel;
    return () => {
      supabaseAuth.removeChannel(channel);
    };
  }, [mergeRow]);

  // ── Tick: recompute relative timestamps every 5 s ──
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ── Count alive agents ──
  const aliveCount = Object.values(processRowByKey).filter((row) => {
    if (row.status === 'crashed' || row.status === 'stopped') return false;
    if (!row.last_heartbeat_at) return false;
    return Date.now() - new Date(row.last_heartbeat_at).getTime() <= 2 * 60 * 1000;
  }).length;

  const handleCardClick = (orderKey) => setSelectedAgentId(orderKey);
  const handleModalClose = () => setSelectedAgentId(null);

  return (
    <div className="min-h-screen bg-surface-950 p-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-4 mb-8">
        <motion.div
          animate={{ scale: [1, 1.25, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
          className="w-3 h-3 rounded-full bg-emerald-400 flex-shrink-0"
        />
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">
            Heartbeat Wall
          </h1>
          <p className="text-xs text-white/40 mt-0.5">
            {loading ? 'Cargando…' : `${aliveCount}/10 agentes vivos`}
          </p>
        </div>
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <div className="flex items-center justify-center py-32 text-white/30 text-sm">
          Conectando con Supabase…
        </div>
      ) : (
        <motion.div
          variants={GRID_VARIANTS}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
        >
          {AGENT_ORDER.map((key) => {
            const row = processRowByKey[key] ?? null;
            // Find the canonical db name for display (from row if available)
            const dbName = row?.agent_name ?? key;
            const agentStats = statsMap[key] ?? null;

            return (
              <AgentHeartbeatCard
                key={key}
                agentDbName={dbName}
                processRow={row}
                stats={agentStats}
                nowMs={nowMs}
                onClick={() => handleCardClick(key)}
              />
            );
          })}
        </motion.div>
      )}

      {/* ── Agent Detail Modal ── */}
      <AnimatePresence>
        {selectedAgentId && (
          <AgentDetailModal
            agentId={selectedAgentId}
            events={[]}
            onClose={handleModalClose}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
