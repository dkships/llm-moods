import { motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";

const PageTransition = ({ children }: { children: ReactNode }) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={shouldReduceMotion ? undefined : { opacity: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0, 0, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
};

export default PageTransition;
