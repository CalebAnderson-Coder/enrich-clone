/**
 * Shared Framer Motion transition presets — springs for premium feel.
 *
 *   import { snappy, gentle } from '@/components/shared/motion';
 *   <motion.div transition={snappy} ... />
 */

// Quick, decisive — taps, badge pop-ins, micro-interactions
export const snappy = {
  type: "spring",
  stiffness: 400,
  damping: 30,
  mass: 0.8,
};

// Smooth, lower-energy — page transitions, layout shifts, larger moves
export const gentle = {
  type: "spring",
  stiffness: 200,
  damping: 25,
};
