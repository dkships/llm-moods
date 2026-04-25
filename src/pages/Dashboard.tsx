import { TrendingUp, TrendingDown, MessageSquare, Zap, ExternalLink } from "lucide-react";
import { memo, useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
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
import { getVibeStatus, fadeUp, SENTIMENT_STYLES, formatComplaintLabel, formatTimeAgo, formatSourceDisplay, decodeHTMLEntities } from "@/lib/vibes";
import { DashboardCardSkeleton, ChatterSkeleton } from "@/components/Skeletons";
import TrendingComplaints from "@/components/TrendingComplaints";

// Lazy load recharts sparkline
const LazySparkline = lazy(() => import("@/components/Sparkline"));

/** Memoized model card */
const ModelCard = memo(({ m, i, onHover }: { m: ModelWithVibes; i: number; onHover: (slug: string, id: string) => void }) => {
  const vibe = getVibeStatus(m.latestScore);
  const VibeIcon = vibe.icon;
  const brandColor = m.accent_color || "#888";

  return (
    <Link
      to={`/model/${m.slug}`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onMouseEnter={() => onHover(m.slug, m.id)}
    >
      <motion.div
        variants={fadeUp}
        custom={i}
        className="glass rounded-xl overflow-hidden transition-all duration-300 cursor-pointer h-full hover:-translate-y-1"
        whileHover={{ boxShadow: `0 0 24px ${vibe.color}25, 0 8px 32px ${vibe.color}15` }}
      >
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
              <p className="text-xs text-foreground/65 font-mono mt-0.5">/ 100</p>
            </div>
          </div>

          {/* Sparkline — lazy loaded */}
          {m.sparkline.length > 1 && (
            <div className="mt-4 h-12" aria-hidden="true">
              <Suspense fallback={<div className="h-12 animate-pulse rounded bg-secondary/40" />}>
                <LazySparkline data={m.sparkline} accent={vibe.color} />
              </Suspense>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              {m.trend.direction === "up" ? (
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-red-200" />
              )}
              <span className={m.trend.direction === "up" ? "text-primary" : "text-red-200"}>
                {m.trend.direction === "up" ? "up" : "down"} {m.trend.pts} pts from yesterday
              </span>
            </div>
            <span className="text-foreground/70">Recent volume: {(m.totalPosts || 0).toLocaleString()} posts (7d)</span>
          </div>

          {m.topComplaint && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <Zap className="h-3.5 w-3.5 text-foreground/65" />
              <span className="text-foreground/65">Top complaint:</span>
              <span className="text-foreground font-medium">{formatComplaintLabel(m.topComplaint)}</span>
            </div>
          )}
        </div>
      </motion.div>
    </Link>
  );
});
ModelCard.displayName = "ModelCard";

/** Memoized chatter post */
const ChatterPost = memo(({ post, i }: { post: RecentChatterPost; i: number }) => {
  const sentiment = post.sentiment || "neutral";
  const s = SENTIMENT_STYLES[sentiment];
  const src = formatSourceDisplay(post.source);
  const modelData = post.models;
  const sentimentBorderColor = sentiment === "positive" ? "border-l-emerald-500" : sentiment === "negative" ? "border-l-red-500" : "border-l-muted-foreground/30";
  const sourceUrl = post.source_url ?? undefined;
  const className = `glass rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-l-2 ${sentimentBorderColor} transition-all duration-200 hover:brightness-125 hover:border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${sourceUrl ? "cursor-pointer" : ""}`;
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
              <span className="ml-1.5 inline-flex items-center text-[10px] font-mono text-foreground/60 bg-secondary/50 px-1 py-0.5 rounded border border-border/30 cursor-help whitespace-nowrap">
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
        {post.posted_at && <span className="text-xs text-foreground font-mono">{formatTimeAgo(post.posted_at)}</span>}
        {sourceUrl && <ExternalLink className="h-3 w-3 text-foreground/50 shrink-0" />}
      </div>
    </>
  );

  if (sourceUrl) {
    return (
      <motion.a
        variants={fadeUp}
        custom={i}
        className={className}
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {content}
      </motion.a>
    );
  }

  return (
    <motion.div
      variants={fadeUp}
      custom={i}
      className={className}
    >
      {content}
    </motion.div>
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

  // Lazy load chatter when section is in view
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

  const latestScoreUpdate = (models || []).reduce<string | null>((latest, model) => {
    if (!model.lastUpdated) return latest;
    if (!latest) return model.lastUpdated;
    return new Date(model.lastUpdated).getTime() > new Date(latest).getTime() ? model.lastUpdated : latest;
  }, null);

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          {/* Page Header */}
          <section className="container pt-10 pb-8">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h1 className="text-3xl sm:text-4xl font-bold text-foreground">Current Vibes</h1>
                <DataFreshnessIndicator lastUpdated={latestScoreUpdate} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <p className="text-sm text-foreground/70 font-mono">{today}</p>
              </div>
              <p className="mt-2 text-sm text-foreground/70">Latest daily sentiment score with recent chatter from Reddit, Bluesky, Mastodon, X, and more.</p>
            </motion.div>
          </section>

          {/* Model Cards */}
          <section className="container pb-12">
            {modelsLoading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" role="status" aria-live="polite">
                {Array.from({ length: 4 }).map((_, i) => <DashboardCardSkeleton key={i} />)}
              </div>
            ) : modelsError ? (
              <p className="py-8 text-center text-sm text-muted-foreground" role="status" aria-live="polite">
                Failed to load data
              </p>
            ) : (
              <motion.div
                initial="hidden"
                animate="visible"
                variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
                className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
              >
                {(models || []).map((m, i) => (
                  <ModelCard key={m.id} m={m} i={i} onHover={handleHover} />
                ))}
              </motion.div>
            )}
          </section>

          {/* Trending Complaints */}
          <section className="container pb-12">
            <TrendingComplaints />
          </section>

          {/* Community Chatter — lazy loaded on scroll */}
          <section className="container pb-12" ref={chatterRef}>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
            >
              <div className="flex items-center gap-2 mb-6">
                <MessageSquare className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-bold text-foreground">Recent Community Chatter</h2>
              </div>
            </motion.div>

            {chatterError ? (
              <p className="py-8 text-center text-sm text-muted-foreground" role="status" aria-live="polite">
                Failed to load data
              </p>
            ) : !chatterVisible || chatterLoading ? (
              <div className="space-y-3" role="status" aria-live="polite">
                {Array.from({ length: 6 }).map((_, i) => <ChatterSkeleton key={i} />)}
              </div>
            ) : (
              <div className="space-y-3">
                {(chatterData?.pages ?? []).flatMap((page) => page).map((post, i) => (
                  <ChatterPost key={post.id} post={post} i={i} />
                ))}
              </div>
            )}

            {hasNextPage && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  aria-label="Load more community posts"
                  className="rounded-lg border border-border bg-secondary/50 px-5 py-2 text-xs font-mono text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                >
                  {isFetchingNextPage ? "Loading..." : "Load more"}
                </button>
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
