import { ReactNode } from "react";

// Page-enter fade via the shared `animate-fade-in` keyframe (tailwind.config.ts).
// prefers-reduced-motion is honored globally in index.css, which zeroes all
// animation durations — so no per-component reduced-motion branch is needed.
const PageTransition = ({ children }: { children: ReactNode }) => (
  <div className="animate-fade-in">{children}</div>
);

export default PageTransition;
