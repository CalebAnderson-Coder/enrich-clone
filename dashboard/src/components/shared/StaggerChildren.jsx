import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Stagger item variants — apply to each motion.* child to inherit the
 * stagger timing from the parent container.
 *
 *   <StaggerChildren>
 *     {items.map((it) => (
 *       <motion.div key={it.id} variants={staggerItem}>...</motion.div>
 *     ))}
 *   </StaggerChildren>
 */
export const staggerItem = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 320, damping: 26 },
  },
};

/**
 * StaggerChildren — motion.div container that staggers the entrance of its
 * motion children. Children must consume `staggerItem` variants to animate.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {number} [props.staggerDelay=0.05] Seconds between each child.
 * @param {string} [props.className]
 */
export default function StaggerChildren({
  children,
  staggerDelay = 0.05,
  className,
}) {
  const container = {
    hidden: { opacity: 1 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: staggerDelay,
        delayChildren: 0.02,
      },
    },
  };

  return (
    <motion.div
      className={cn(className)}
      variants={container}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}
