import { useEffect, useState } from "react";
import { getVibeStatus } from "@/lib/vibes";

interface HeroVibeGaugeProps {
  /** Rounded average score across tracked models (0–100). Null while loading/empty. */
  score: number | null;
  isLoading?: boolean;
  /** Visual size: "lg" for the desktop right column, "sm" for the compact mobile slot. */
  size?: "lg" | "sm";
}

const DIMENSIONS = {
  lg: { size: 280, stroke: 10, scoreClass: "text-score-xl", labelClass: "text-section" },
  sm: { size: 156, stroke: 7, scoreClass: "text-score", labelClass: "text-body text-foreground" },
} as const;

/**
 * Live "overall vibe" gauge for the hero. Renders large in the desktop right
 * column and compact above the headline on mobile.
 * Presentational: parent computes the average score. Colors route through
 * getVibeStatus (SENTIMENT_HSL) — the gauge is a large sibling of the score
 * number, so sentiment hue here is intentional, not decorative chrome.
 */
const HeroVibeGauge = ({ score, isLoading = false, size = "lg" }: HeroVibeGaugeProps) => {
  const { size: SIZE, stroke: STROKE, scoreClass, labelClass } = DIMENSIONS[size];
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * RADIUS;

  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const [animatedScore, setAnimatedScore] = useState(prefersReduced ? score ?? 0 : 0);

  useEffect(() => {
    if (score == null) return;
    if (prefersReduced) {
      setAnimatedScore(score);
      return;
    }
    const id = requestAnimationFrame(() => setAnimatedScore(score));
    return () => cancelAnimationFrame(id);
  }, [score, prefersReduced]);

  // Loading skeleton ring.
  if (isLoading || score == null) {
    return (
      <div
        className="relative flex items-center justify-center"
        style={{ width: SIZE, height: SIZE }}
        aria-hidden="true"
      >
        <svg width={SIZE} height={SIZE} className="animate-pulse">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={STROKE}
          />
        </svg>
      </div>
    );
  }

  const vibe = getVibeStatus(score);
  const dash = CIRC * (animatedScore / 100);

  return (
    <div
      className="relative flex animate-in fade-in duration-700 items-center justify-center"
      style={{ width: SIZE, height: SIZE }}
      role="img"
      aria-label={`Overall AI vibe today: ${score} out of 100, ${vibe.label}`}
    >
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={vibe.color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC - dash}
          style={{
            transition: prefersReduced
              ? undefined
              : "stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: `drop-shadow(0 0 12px ${vibe.color})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <span className={`${scoreClass} leading-none`} style={{ color: vibe.color }}>
          {score}
        </span>
        <span className={`${labelClass} text-foreground`}>{vibe.label}</span>
        <span className="text-mono-cap text-text-tertiary">Avg · all models</span>
      </div>
    </div>
  );
};

export default HeroVibeGauge;