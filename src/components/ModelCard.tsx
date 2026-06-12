import { memo, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import Surface from "@/components/Surface";
import { getVibeStatus, formatComplaintLabel } from "@/lib/vibes";
import type { ModelWithVibes } from "@/hooks/useVibesData";

const LazySparkline = lazy(() => import("@/components/Sparkline"));

interface ModelCardProps {
  m: ModelWithVibes;
  showSparkline?: boolean;
  onHover?: (slug: string, id: string) => void;
}

const ModelCard = memo(({ m, showSparkline = false, onHover }: ModelCardProps) => {
  const vibe = getVibeStatus(m.latestScore);
  const brandColor = m.accent_color || "#888";

  const trendUp = m.trend.direction === "up" && !m.isLatestCarryForward && !m.isStale;
  const trendDown = m.trend.direction === "down" && !m.isLatestCarryForward && !m.isStale;
  const trendCaption = m.isStale
    ? "STALE SCORE"
    : m.isLatestCarryForward
    ? "NO NEW POSTS"
    : trendUp
    ? `+${m.trend.pts} PTS`
    : trendDown
    ? `-${m.trend.pts} PTS`
    : "0 PTS";
  const postsCaption = `${(m.totalPosts || 0).toLocaleString()} POSTS`;

  return (
    <Link
      to={`/model/${m.slug}`}
      onMouseEnter={() => onHover?.(m.slug, m.id)}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Surface size="bare" motion="fade" elevation="lift" className="relative overflow-hidden h-full">
        {/* Sentiment cue: 3px top bar on >=sm (grid layouts), 2px left rail on mobile
            stacks so four cards don't read as a barcode of stacked color bars. */}
        <div
          className="absolute inset-y-0 left-0 w-[3px] sm:inset-x-0 sm:bottom-auto sm:h-1.5 sm:w-auto"
          style={{ background: vibe.color }}
          aria-hidden="true"
        />
        <div className="p-6">
          <p className="text-mono-cap text-text-tertiary">{vibe.label}</p>
          <div className="mt-1 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: brandColor }} />
              <p className="truncate text-section text-foreground">{m.name}</p>
            </div>
            <p className="shrink-0 text-score" style={{ color: vibe.color }}>
              {m.latestScore}
            </p>
          </div>

          {showSparkline && m.sparkline.length > 1 && (
            <div className="mt-4 h-12" aria-hidden="true">
              <Suspense fallback={<div className="h-12 animate-pulse rounded bg-secondary/40" />}>
                <LazySparkline data={m.sparkline} accent="hsl(var(--foreground) / 0.7)" />
              </Suspense>
            </div>
          )}

          <p className="mt-3 text-mono-cap">
            <span className="text-text-secondary">{trendCaption}</span>
            <span className="text-text-tertiary"> · {postsCaption}</span>
            {m.scoreBasisStatus === "thin_sample" && (
              <span
                className="text-text-tertiary"
                title="Today's score rests on a small number of high-confidence posts"
              >
                {" "}· LOW SAMPLE
              </span>
            )}
          </p>

          {m.topComplaint && (
            <div className="mt-4 flex items-baseline gap-2 border-t border-border pt-3">
              <span className="shrink-0 text-mono-cap text-text-tertiary">Mostly</span>
              <span className="truncate text-body font-medium text-foreground">
                {formatComplaintLabel(m.topComplaint)}
              </span>
            </div>
          )}
        </div>
      </Surface>
    </Link>
  );
});
ModelCard.displayName = "ModelCard";

export default ModelCard;
