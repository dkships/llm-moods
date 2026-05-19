import { MessageSquare } from "lucide-react";
import { memo, useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import SectionHeader from "@/components/SectionHeader";
import Surface from "@/components/Surface";
import useHead from "@/hooks/useHead";
import Footer from "@/components/Footer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useModelsWithLatestVibes,
  useRecentChatter,
  usePrefetchModelDetail,
  type ModelWithVibes,
  type RecentChatterPost,
} from "@/hooks/useVibesData";
import StalenessBanner from "@/components/StalenessBanner";
import { getVibeStatus, formatComplaintLabel, formatTimeAgo, formatSourceDisplay, decodeHTMLEntities } from "@/lib/vibes";
import { DashboardCardSkeleton, ChatterSkeleton } from "@/components/Skeletons";
import TrendingComplaints from "@/components/TrendingComplaints";

const LazySparkline = lazy(() => import("@/components/Sparkline"));

/** Memoized model card */
const ModelCard = memo(({ m, onHover }: { m: ModelWithVibes; i: number; onHover: (slug: string, id: string) => void }) => {
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
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onMouseEnter={() => onHover(m.slug, m.id)}
    >
      <Surface size="bare" motion="fade" className="overflow-hidden h-full">
        <div className="h-1.5" style={{ background: vibe.color }} />
        <div className="p-6">
          <p className={`text-mono-cap text-text-tertiary`}>{vibe.label}</p>
          <div className="mt-1 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: brandColor }} />
              <p className="truncate font-display text-lg font-semibold text-foreground">{m.name}</p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <p
                  className="shrink-0 cursor-help text-score"
                  style={{ color: vibe.color }}
                >
                  {m.latestScore}
                </p>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-meta">
                0 = everyone's complaining, 100 = pure good vibes
              </TooltipContent>
            </Tooltip>
          </div>

          {m.sparkline.length > 1 && (
            <div className="mt-4 h-12" aria-hidden="true">
              <Suspense fallback={<div className="h-12 animate-pulse rounded bg-secondary/40" />}>
                <LazySparkline data={m.sparkline} accent="hsl(var(--foreground) / 0.55)" />
              </Suspense>
            </div>
          )}

          <p className={`mt-3 text-mono-cap`}>
            <span className="text-text-secondary">{trendCaption}</span>
            <span className="text-text-tertiary"> · {postsCaption}</span>
          </p>

          {m.topComplaint && (
            <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
              <span className={`text-mono-cap shrink-0 text-text-tertiary`}>Top</span>
              <span className="truncate text-sm font-medium text-foreground">
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

/** Memoized chatter post */
const ChatterPost = memo(({ post }: { post: RecentChatterPost; i: number }) => {
  const src = formatSourceDisplay(post.source);
  const modelData = post.models;
  const sourceUrl = post.source_url ?? undefined;

  const metaPieces = [
    `${src.emoji} ${src.label}`,
    modelData?.name,
    post.posted_at ? formatTimeAgo(post.posted_at) : null,
  ].filter(Boolean) as string[];

  const content = (
    <div className="flex flex-col gap-2">
      <p
        className="text-mono-cap text-text-tertiary"
        title={post.posted_at ? `Posted on ${src.label} at ${new Date(post.posted_at).toLocaleString()}` : undefined}
      >
        {metaPieces.join(" · ")}
      </p>
      <p className="line-clamp-2 text-sm leading-[1.55] text-foreground">
        {decodeHTMLEntities(post.translated_content || post.content || post.title || "")}
        {post.original_language && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-1.5 inline-flex cursor-help items-center whitespace-nowrap rounded border border-border/30 bg-secondary/50 px-1 py-0.5 font-mono text-[10px] text-text-tertiary">
                Translated from {post.original_language.toUpperCase()}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm">
              <p className="text-xs">{post.content?.slice(0, 300)}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </p>
    </div>
  );

  if (sourceUrl) {
    return (
      <Surface
        as="a"
        size="compact"
        motion="fade"
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {content}
      </Surface>
    );
  }

  return (
    <Surface size="compact" motion="fade">
      {content}
    </Surface>
  );
});
ChatterPost.displayName = "ChatterPost";

const Dashboard = () => {
  useHead({
    title: "Dashboard — LLM Vibes",
    description: "Latest sentiment scores, trends, and community chatter for Claude, ChatGPT, Gemini, and Grok.",
    url: "/dashboard",
  });
  const { data: models, isLoading: modelsLoading, isError: modelsError } = useModelsWithLatestVibes();
  const prefetch = usePrefetchModelDetail();

  const chatterRef = useRef<HTMLDivElement>(null);
  const [chatterVisible, setChatterVisible] = useState(false);
  useEffect(() => {
    const el = chatterRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setChatterVisible(true); observer.disconnect(); } },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { data: chatterData, isLoading: chatterLoading, isError: chatterError, fetchNextPage, hasNextPage, isFetchingNextPage } = useRecentChatter(chatterVisible);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const handleHover = useCallback((slug: string, id: string) => {
    prefetch(slug, id);
  }, [prefetch]);

  const latestScoreUpdate = (models || []).reduce<string | null>((oldest, model) => {
    if (!model.lastUpdated) return oldest;
    if (!oldest) return model.lastUpdated;
    return new Date(model.lastUpdated).getTime() < new Date(oldest).getTime() ? model.lastUpdated : oldest;
  }, null);

  // Newest score_computed_at across all models. Drives the staleness banner —
  // if no model has been refreshed in 3+ hours, the pipeline is likely paused.
  const mostRecentScoreAt = (models || []).reduce<string | null>((newest, model) => {
    if (!model.scoreComputedAt) return newest;
    if (!newest) return model.scoreComputedAt;
    return new Date(model.scoreComputedAt).getTime() > new Date(newest).getTime() ? model.scoreComputedAt : newest;
  }, null);

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          <StalenessBanner mostRecentScoreAt={mostRecentScoreAt} />

          {/* Page Header */}
          <section className="container pt-10 pb-8">
            <h1 className="text-page text-foreground">
              Current Vibes
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40"
                aria-hidden="true"
              />
              <p
                className="text-meta text-text-tertiary"
                role="status"
                aria-live="polite"
              >
                {latestScoreUpdate
                  ? `Updated ${formatTimeAgo(latestScoreUpdate)} · ${today}`
                  : today}
              </p>
            </div>
          </section>

          {/* Model Cards */}
          <section className="container pb-12">
            {modelsLoading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" role="status" aria-live="polite">
                {Array.from({ length: 4 }).map((_, i) => <DashboardCardSkeleton key={i} />)}
              </div>
            ) : modelsError ? (
              <p className="py-8 text-center text-sm text-text-tertiary" role="status" aria-live="polite">
                Failed to load data
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 animate-fade-in">
                {(models || []).map((m, i) => (
                  <ModelCard key={m.id} m={m} i={i} onHover={handleHover} />
                ))}
              </div>
            )}
          </section>

          {/* Trending Complaints */}
          <section className="container pb-12">
            <TrendingComplaints />
          </section>

          {/* Community Chatter — lazy loaded on scroll */}
          <section className="container pb-12" ref={chatterRef}>
            <SectionHeader
              level="page"
              icon={MessageSquare}
              title="Recent Community Chatter"
            />

            {chatterError ? (
              <p className="py-8 text-center text-sm text-text-tertiary" role="status" aria-live="polite">
                Failed to load data
              </p>
            ) : !chatterVisible || chatterLoading ? (
              <div className="space-y-3" role="status" aria-live="polite">
                {Array.from({ length: 6 }).map((_, i) => <ChatterSkeleton key={i} />)}
              </div>
            ) : (chatterData?.pages ?? []).flatMap((page) => page).length === 0 ? (
              <p className="py-8 text-center text-sm text-text-tertiary">
                No posts in the last 7 days.
              </p>
            ) : (
              <div className="space-y-3">
                {(chatterData?.pages ?? []).flatMap((page) => page).map((post, i) => (
                  <ChatterPost key={post.id} post={post} i={i} />
                ))}
              </div>
            )}

            {hasNextPage && (
              <div className="mt-6 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  aria-label="Load more community posts"
                  className="font-mono text-xs"
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </section>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default Dashboard;
