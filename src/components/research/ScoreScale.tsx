/**
 * The 0–100 vibes scale as a strip, for research cards whose post has no
 * score series (the methodology write-up). Bands match getVibeStatus in
 * src/lib/vibes.ts. Neutral on purpose: sentiment hue is reserved for scores.
 */

const BANDS = [
  { label: "Bad vibes", from: 0, to: 40 },
  { label: "Mixed signals", from: 40, to: 65 },
  { label: "Good vibes", from: 65, to: 100 },
];

const ScoreScale = ({ className = "" }: { className?: string }) => (
  <div className={`flex h-14 items-end ${className}`} role="img" aria-label="The LLM Vibes score scale: 0 to 40 is bad vibes, 40 to 65 mixed signals, 65 to 100 good vibes.">
    {BANDS.map((band, i) => (
      <div
        key={band.label}
        aria-hidden="true"
        className={`flex h-full flex-col justify-end border-b-2 border-muted-foreground/40 pb-1.5 ${i > 0 ? "border-l border-l-border pl-2" : ""}`}
        style={{ width: `${band.to - band.from}%` }}
      >
        <span className="text-meta text-text-tertiary">{band.from}</span>
        <span className="truncate text-meta text-text-secondary">{band.label}</span>
      </div>
    ))}
  </div>
);

export default ScoreScale;
