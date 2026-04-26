import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CONFIDENCE_TIER_LABELS,
  getConfidenceTier,
  type ConfidenceTier,
} from "@/lib/vibes";

interface ConfidenceChipProps {
  eligiblePosts: number | null | undefined;
  className?: string;
  /** Render a smaller variant for chart tooltips and dense rows */
  size?: "default" | "sm";
}

// Tints derive from the existing semantic tokens so a future theme swap
// flows through. Sentiment colors are reserved for the score itself; these
// confidence tints reuse warning / muted / primary at low alpha so the chip
// reads as meta rather than competing with the headline number.
const TIER_CLASSES: Record<ConfidenceTier, string> = {
  preliminary: "bg-warning/10 text-warning border-warning/30",
  good: "bg-muted/40 text-text-tertiary border-border",
  strong: "bg-primary/10 text-primary border-primary/30",
};

export function ConfidenceChip({
  eligiblePosts,
  className,
  size = "default",
}: ConfidenceChipProps) {
  const tier = getConfidenceTier(eligiblePosts);
  const n = eligiblePosts ?? 0;

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium tracking-wide uppercase rounded-md",
        size === "sm" ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[10px]",
        TIER_CLASSES[tier],
        className,
      )}
      aria-label={`${CONFIDENCE_TIER_LABELS[tier]} confidence based on ${n} eligible posts`}
      title={`Based on ${n} eligible post${n === 1 ? "" : "s"} (confidence ≥ 0.65) in this window`}
    >
      {CONFIDENCE_TIER_LABELS[tier]}
    </Badge>
  );
}
