import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Radio } from 'lucide-react';
import { supabaseAuth } from '../lib/supabaseAuthClient';
import NewsroomBubble from '../components/Newsroom/NewsroomBubble';

const BRAND_ID      = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const MAX_ROWS      = 150;
const INITIAL_LIMIT = 100;

// Message types that matter for a non-tech demo
const HUMANO_WORTHY_TYPES = new Set([
  'outbound_completed',
  'seo_audit_completed',
  'pattern_detected',
  'verify_email_verdict',
  'batch_acknowledged',
]);

function isHumanoWorthy(row) {
  const type = row.payload?.type;
  if (!HUMANO_WORTHY_TYPES.has(type)) return false;
  // For verify_email_verdict, only show passes
  if (type === 'verify_email_verdict') {
    const p = row.payload;
    const score = p?.overall ?? p?.score ?? 0;
    return p?.verdict === 'pass' || p?.decision === 'pass' || (typeof score === 'number' && score >= 7);
  }
  return true;
}

export default function NewsroomView() {
  const [rows, setRows]           = useState([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter]       = useState('all'); // 'all' | 'humano'
  const channelRef                = useRef(null);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;

    async function loadInitial() {
      const { data, error } = await supabaseAuth
        .from('agent_messages')
        .select('*')
        .eq('brand_id', BRAND_ID)
        .order('created_at', { ascending: false })
        .limit(INITIAL_LIMIT);

      if (error) {
        console.error('[NewsroomView] initial load error:', error);
        return;
      }
      if (!alive) return;

      // Reverse to chronological (oldest first → newest last in array)
      // We render newest-first so we prepend new messages, but the initial
      // load goes oldest→newest so the feed starts reading top-to-bottom.
      const chronological = (data || []).slice().reverse();
      setRows(chronological);
    }

    loadInitial();
    return () => { alive = false; };
  }, []);

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabaseAuth
      .channel('newsroom-agent-messages')
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'agent_messages',
          filter: `brand_id=eq.${BRAND_ID}`,
        },
        (payload) => {
          const newRow = payload.new;
          setRows(prev => {
            // Prepend new message; trim to MAX_ROWS
            const next = [newRow, ...prev];
            return next.length > MAX_ROWS ? next.slice(0, MAX_ROWS) : next;
          });
        }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      supabaseAuth.removeChannel(channel);
    };
  }, []);

  // ── Filtered view ─────────────────────────────────────────────────────────
  // rows is newest-first (prepend on INSERT), so the feed shows newest at top.
  const displayed = filter === 'humano' ? rows.filter(isHumanoWorthy) : rows;

  return (
    <div className="min-h-full w-full p-6 lg:p-8 bg-gradient-to-br from-surface-950 via-[#0b0b1a] to-surface-950 text-white">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between mb-6 gap-4 flex-wrap"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
            <Radio
              size={22}
              className={connected ? 'text-emerald-400 animate-pulse' : 'text-white/30'}
            />
            Newsroom Empírika
          </h1>
          <p className="text-sm text-white/50 mt-1">
            Conversación de los agentes en vivo
          </p>
        </div>

        {/* Connection indicator */}
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest mt-1">
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`}
          />
          <span className={connected ? 'text-emerald-300' : 'text-white/30'}>
            {connected ? 'en línea' : 'desconectado'}
          </span>
        </div>
      </motion.div>

      {/* ── Filter pills ────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'all',    label: 'Todos' },
          { key: 'humano', label: 'Solo HUMANO-WORTHY' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all border ${
              filter === key
                ? 'bg-white/15 border-white/30 text-white'
                : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-white/30 self-center">
          {displayed.length} mensaje{displayed.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Feed ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 max-w-3xl mx-auto">
        <AnimatePresence initial={false}>
          {displayed.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-white/30 text-sm py-20"
            >
              Esperando mensajes entre agentes…
            </motion.div>
          ) : (
            displayed.map((row) => (
              <NewsroomBubble key={row.id} row={row} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
