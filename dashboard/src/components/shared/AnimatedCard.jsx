import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * AnimatedCard — motion.div wrapper for cards with spring entrance,
 * hover scale 1.02 and tap scale 0.98. Intended to wrap <Card> (shadcn)
 * or any content block that should feel tactile.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {string} [props.className]
 * @param {number} [props.delay=0] Seconds to stagger the entrance.
 * @param {() => void} [props.onClick]
 * @param {import('react').HTMLAttributes<HTMLDivElement>} [props.rest]
 */
export default function AnimatedCard({
  children,
  className,
  delay = 0,
  onClick,
  ...rest
}) {
  return (
    <motion.div
      className={cn(className)}
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 24,
        duration: 0.3,
        delay,
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
