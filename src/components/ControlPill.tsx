/**
 * The neutral secondary control: RSS subscribe, dataset download, share links.
 *
 * This class string previously lived as a copy-pasted `CONTROL_CLASS` constant
 * in three files (ShareLinks, ResearchIndex, ResearchPost), which had already
 * started to drift. It is the third and last member of the small-control family
 * alongside FilterChip (toggleable) and Tag (non-interactive), and shares their
 * `rounded-md` radius so the family reads as one system — it used to be
 * `rounded-lg`, the only 8px radius among 6px siblings.
 *
 * Neutral surface, mono-cap label, no accent tint: the accent hue stays
 * reserved for chart stroke, the hero glow, and NavBar.
 */
export const CONTROL_PILL_CLASS =
  "inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-mono-cap text-text-secondary transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Compose the control-pill recipe with extra utilities. */
export const controlPill = (className = "") =>
  className ? `${CONTROL_PILL_CLASS} ${className}` : CONTROL_PILL_CLASS;
