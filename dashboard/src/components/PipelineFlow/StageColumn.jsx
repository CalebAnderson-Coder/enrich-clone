import React from 'react';
import { motion } from 'framer-motion';

const GLASS = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl';

// Color accents per stage. Empírika color philosophy: emerald = forward
// momentum, slate = neutral, rose = stalled. We keep stage-specific tints
// subtle so the row reads as a single bar, not a rainbow.
const STAGE_ACCENTS = {
  'Pre-pipeline': { bar: 'from-slate-500/30 to-slate-700/10', dot: 'bg-slate-400' },
  NUEVO:          { bar: 'from-sky-500/30 to-sky-700/10',     dot: 'bg-sky-400' },
  CONTACTADO:     { bar: 'from-primary-500/30 to-fuchsia-700/10', dot: 'bg-fuchsia-400' },
  INTERESADO:     { bar: 'from-emerald-500/30 to-emerald-700/10', dot: 'bg-emerald-400' },
  Otros:          { bar: 'from-amber-500/20 to-amber-700/10', dot: 'bg-amber-400' },
};

function truncate(str, n = 28) {
  if (!str) return '';
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

export default function StageColumn({ stage, count, share, samples, index }) {
  const accent = STAGE_ACCENTS[stage] || STAGE_ACCENTS.Otros;
  // Width proportional to share of total leads. Floor of 8% so empty
  // stages still render as a visible column rather than a sliver.
  const widthPct = Math.max(share * 100, 8);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
      className={`${GLASS} relative overflow-hidden p-4 flex flex-col`}
      style={{ flex: `${widthPct} 0 0`, minWidth: 160 }}
    >
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: '100%' }}
        transition={{ duration: 0.7, delay: 0.1 + index * 0.06 }}
        className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${accent.bar}`}
      />

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${accent.dot}`} />
          <span className="text-[11px] uppercase tracking-widest font-semibold text-white/70">
            {stage}
          </span>
        </div>
        <span className="text-[10px] font-mono text-white/40">
          {(share * 100).toFixed(0)}%
        </span>
      </div>

      <div className="text-3xl font-semibold text-white tracking-tight mb-3">
        {count.toLocaleString('es-MX')}
      </div>

      <div className="space-y-1 text-[11px] text-white/60">
        {samples.length === 0 && (
          <div className="text-white/30 italic">sin leads</div>
        )}
        {samples.map((name, i) => (
          <div key={i} className="truncate" title={name}>
            · {truncate(name)}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
