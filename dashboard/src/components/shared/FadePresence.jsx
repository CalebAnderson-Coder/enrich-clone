import { AnimatePresence } from "framer-motion";

/**
 * Shared fade variants — apply to motion.div children inside FadePresence
 * so conditional mount/unmount fades consistently.
 *
 *   <FadePresence>
 *     {open && (
 *       <motion.div key="panel" variants={fadeVariants} initial="initial" animate="animate" exit="exit">
 *         ...
 *       </motion.div>
 *     )}
 *   </FadePresence>
 */
export const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: "easeIn" } },
};

/**
 * FadePresence — thin wrapper over AnimatePresence for mount/unmount fades.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {"wait" | "sync" | "popLayout"} [props.mode="wait"]
 * @param {boolean} [props.initial] Forward to AnimatePresence (default undefined).
 */
export default function FadePresence({ children, mode = "wait", initial }) {
  return (
    <AnimatePresence mode={mode} initial={initial}>
      {children}
    </AnimatePresence>
  );
}
