import { TrendingUp, TrendingDown, Minus, MessageSquare, Zap, ExternalLink } from "lucide-react";
import { memo, useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import PageHeader from "@/components/PageHeader";
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
import DataFreshnessIndicator from "@/components/DataFreshnessIndicator";
import { getVibeStatus, SENTIMENT_STYLES, formatComplaintLabel, formatTimeAgo, formatSourceDisplay, decodeHTMLEntities, sentimentBorderClass } from "@/lib/vibes";
import { DashboardCardSkeleton, ChatterSkeleton } from "@/components/Skeletons";
import TrendingComplaints from "@/components/TrendingComplaints";

const LazySparkline = lazy(() => import("@/components/Sparkline"));

/** Memoized model card */
const ModelCard = memo(({ m, onHover }: { m: ModelWithVibes; i: number; onHover: (slug: string, id: string) => void }) => {
  const vibe = getVibeStatus(m.latestScore);
  const VibeIcon = vibe.icon;
  const brandColor = m.accent_color || "#888";

  const trendDown = m.trend.direction === "down" && !m.isLatestCarryForward;
  const trendUp = m.trend.direction === "up" && !m.isLatestCarryForward;

  return (
    <Link
      to={`/model/${m.slug}`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onMouseEnter={() => onHover(m.slug, m.id)}
    >
      <Surface size="bare" motion="fade" className="overflow-hidden h-full">
        <div className="h-1.5" style={{ background: vibe.color }} />
        <div className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: brandColor }} />
                <p className="font-display text-base font-semibold text-foreground">{m.name}</p>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <VibeIcon className="h-5 w-5" style={{ color: vibe.color }} />
                <span className="font-mono text-sm" style={{ color: vibe.color }}>{vibe.label}</span>
              </div>
            </div>
            <div className="text-right">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-5xl font-extrabold font-mono text-foreground cursor-help leading-none">{m.latestScore}</p>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs font-mono">
                  0 = everyone's complaining, 100 = pure good vibes
                </TooltipContent>
              </Tooltip>
              <p className="text-xs text-text-tertiary font-mono mt-0.5">/ 100</p>
            </div>
          </div>

          {/* Sparkline — lazy loaded */}
          {m.sparkline.length > 1 && (
            <div className="mt-4 h-12 cursor-pointer" aria-hidden="true">
              <Suspense fallback={<div className="h-12 animate-pulse rounded bg-secondary/40" />}>
                <LazySparkline data={m.sparkline} accent={vibe.color} />
              </Suspense>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              {trendUp ? (
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
              ) : trendDown ? (
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
              ) : (
                <Minus className="h-3.5 w-3.5 text-text-tertiary" />
              )}
              <span
                className={
                  m.isLatestCarryForward
                    ? "text-text-tertiary"
                    : trendUp
                    ? "text-primary"
                    : trendDown
                    ? "text-destructive"
                    : "text-text-tertiary"
                }
              >
                {m.isLatestCarryForward
                  ? "no scored posts in latest window"
                  : m.trend.direction === "flat"
                  ? "no change from yesterday"
                  : `${trendUp ? "up" : "down"} ${m.trend.pts} pts from yesterday`}
              </span>
            </div>
            <span className="text-text-tertiary">Recent volume: {(m.totalPosts || 0).toLocaleString()} posts (7d)</span>
          </div>

          {m.topComplaint && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <Zap className="h-3.5 w-3.5 text-text-tertiary" />
              <span className="text-text-tertiary">Top complaint:</span>
              <span className="text-foreground font-medium">{formatComplaintLabel(m.topComplaint)}</span>
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
  const sentiment = post.sentiment || "neutral";
  const s = SENTIMENT_STYLES[sentiment];
  const src = formatSourceDisplay(post.source);
  const modelData = post.models;
  const sourceUrl = post.source_url ?? undefined;
  const cardClasses = `flex flex-col sm:flex-row sm:items-center gap-3 border-l-2 ${sentimentBorderClass(sentiment)}`;
  const linkClasses = sourceUrl
    ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    : "";

  const content = (
    <>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs font-mono text-foreground px-2 py-0.5 rounded bg-secondary border border-border">
          {src.emoji} {src.label}
        </span>
      </div>
      <p className="text-sm text-foreground flex-1 leading-relaxed line-clamp-2">
        {decodeHTMLEntities(post.translated_content || post.content || post.title || "")}
        {post.original_language && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-1.5 inline-flex items-center text-[10px] font-mono text-text-tertiary bg-secondary/50 px-1 py-0.5 rounded border border-border/30 cursor-help whitespace-nowrap">
                Translated from {post.original_language.toUpperCase()}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm">
              <p className="text-xs">{post.content?.slice(0, 300)}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </p>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {modelData && (
          <>
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: modelData.accent_color || "#888" }} />
            <span className="text-xs font-mono text-foreground">{modelData.name}</span>
          </>
        )}
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${s.classes}`}>
          {s.label}
        </Badge>
        {post.posted_at && (
          <span
            className="text-xs text-text-tertiary font-mono"
            title={`Posted on ${src.label} at ${new Date(post.posted_at).toLocaleString()}`}
          >
            {formatTimeAgo(post.posted_at)}
          </span>
        )}
        {sourceUrl && <ExternalLink className="h-3 w-3 text-text-tertiary shrink-0" />}
      </div>
    </>
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
        className={`${cardClasses} ${linkClasses}`.trim()}
      >
        {content}
      </Surface>
    );
  }

  return (
    <Surface size="compact" motion="fade" className={cardClasses}>
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

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          {/* Page Header */}
          <section className="container pt-10 pb-8">
            <PageHeader
              title="Current Vibes"
              meta={today}
              description="Latest daily sentiment score with recent chatter from Reddit, Hacker News, Bluesky, Mastodon, and X."
              freshness={<DataFreshnessIndicator lastUpdated={latestScoreUpdate} />}
            />
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
