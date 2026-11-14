import { memo, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import Surface from "@/components/Surface";
import { getVibeStatus, formatComplaintLabel, getModelAccent } from "@/lib/vibes";
import type { ModelWithVibes } from "@/hooks/useVibesData";

const LazySparkline = lazy(() => import("@/components/Sparkline"));

interface ModelCardProps {
  m: ModelWithVibes;
  showSparkline?: boolean;
  onHover?: (slug: string, id: string) => void;
}

const ModelCard = memo(({ m, showSparkline = false, onHover }: ModelCardProps) => {
  const vibe = getVibeStatus(m.latestScore);
  const brandColor = getModelAccent(m);

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
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Surface size="bare" elevation="lift" className="h-full overflow-hidden">
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: brandColor }} aria-hidden="true" />
              <p className="truncate text-section text-foreground">{m.name}</p>
            </div>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-text-tertiary group-hover:text-foreground" aria-hidden="true" />
          </div>
          <p className="mt-1 text-mono-cap text-text-tertiary">{vibe.label}</p>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <p className="flex items-baseline gap-2">
              <span
                className={`tabular-nums text-score ${m.isStale ? "opacity-60" : ""}`}
                style={{ color: vibe.color }}
              >
                {m.latestScore}
              </span>
              <span className="text-meta text-text-tertiary">/ 100</span>
            </p>
            <span className="pb-1 text-mono-cap text-text-secondary">{trendCaption}</span>
          </div>

          {showSparkline && m.sparkline.length > 1 && (
            <div className="mt-4 h-10" aria-hidden="true">
              <Suspense fallback={<div className="h-full animate-pulse rounded bg-secondary/35" />}>
                <LazySparkline data={m.sparkline} accent="hsl(var(--foreground) / 0.7)" />
              </Suspense>
            </div>
          )}

          <p className="mt-3 text-mono-cap text-text-tertiary">
            {postsCaption}
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
            <div className="mt-4 flex items-baseline gap-2 border-t border-border pt-4">
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
