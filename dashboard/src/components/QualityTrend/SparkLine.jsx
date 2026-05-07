import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

// Inline-SVG line chart for weekly average qualification scores.
// No external chart library — just framer-motion path-length animation.
//
// Props:
//   points: [{ week: ISO string, avgScore: 0..100, n: count }, ...] oldest→newest
//   trend:  'up' | 'flat' | 'down'  (drives stroke + dot colors)
//   width / height: SVG canvas dimensions (default 720 × 220)
export default function SparkLine({ points = [], trend = 'flat', width = 720, height = 220 }) {
  const padX = 36;
  const padY = 24;

  const stroke = trend === 'up'   ? 'rgb(52,211,153)'   // emerald-400
               : trend === 'down' ? 'rgb(251,113,133)'  // rose-400
               :                    'rgb(148,163,184)'; // slate-400

  const fillStop = trend === 'up'   ? 'rgba(52,211,153,0.25)'
                 : trend === 'down' ? 'rgba(251,113,133,0.20)'
                 :                    'rgba(148,163,184,0.18)';

  const { d, area, dots, gridLines } = useMemo(() => {
    if (points.length === 0) return { d: '', area: '', dots: [], gridLines: [] };
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    // Y axis fixed 0..100 (qualification score range).
    const yFor = (v) => padY + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;
    const xFor = (i) => padX + (i * innerW) / Math.max(points.length - 1, 1);

    const coords = points.map((p, i) => ({ x: xFor(i), y: yFor(p.avgScore), p }));
    const path  = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const areaPath = `${path} L${coords[coords.length - 1].x.toFixed(1)},${(padY + innerH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padY + innerH).toFixed(1)} Z`;
    const grid = [0, 25, 50, 75, 100].map((v) => ({ v, y: yFor(v) }));
    return { d: path, area: areaPath, dots: coords, gridLines: grid };
  }, [points, width, height]);

  if (points.length === 0) {
    return <div className="text-white/40 text-sm py-12 text-center">sin datos suficientes</div>;
  }

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id="sparkAreaFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor={fillStop} />
          <stop offset="100%" stopColor="rgba(11,11,26,0)" />
        </linearGradient>
      </defs>
      {gridLines.map((g) => (
        <g key={g.v}>
          <line x1={padX} x2={width - padX} y1={g.y} y2={g.y} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 4" />
          <text x={padX - 8} y={g.y + 3} textAnchor="end" className="text-[9px] fill-white/30">{g.v}</text>
        </g>
      ))}
      <motion.path
        d={area}
        fill="url(#sparkAreaFill)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2, delay: 1.0 }}
      />
      <motion.path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.5, ease: 'easeInOut' }}
      />
      {dots.map((c, i) => (
        <motion.circle
          key={i}
          cx={c.x}
          cy={c.y}
          r={i === dots.length - 1 ? 5 : 3}
          fill={stroke}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 1.4 + i * 0.04 }}
        >
          <title>{`${new Date(c.p.week).toLocaleDateString('es-MX')} · ${c.p.avgScore} pts · ${c.p.n} leads`}</title>
        </motion.circle>
      ))}
      {dots.map((c, i) => {
        const date = new Date(c.p.week);
        const label = `${date.getDate()}/${date.getMonth() + 1}`;
        return (
          <text
            key={`x-${i}`}
            x={c.x}
            y={height - 6}
            textAnchor="middle"
            className="text-[9px] fill-white/40"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
