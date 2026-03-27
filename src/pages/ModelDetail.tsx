import { useParams, Link } from "react-router-dom";
import { TrendingUp, TrendingDown, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect, lazy, Suspense, memo } from "react";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import useHead from "@/hooks/useHead";
import Footer from "@/components/Footer";
import {
  useModelDetail, useVibesHistory, useComplaintBreakdown,
  useSourceBreakdown, useModelPosts, useModelsWithLatestVibes, useDataFreshness,
} from "@/hooks/useVibesData";
import {
  getVibeStatus, fadeUp, COMPLAINT_LABELS, SOURCE_LABELS,
  SENTIMENT_STYLES, formatTimeAgo, formatSourceDisplay, decodeHTMLEntities,
} from "@/lib/vibes";
import { ChartSkeleton, BarsSkeleton, ChatterSkeleton } from "@/components/Skeletons";

// Lazy load the heavy chart component
const LazyVibesChart = lazy(() => import("@/components/VibesChart"));

/** Data freshness indicator — mirrors Dashboard version */
const DataFreshnessIndicator = memo(() => {
  const { data: lastScraped } = useDataFreshness();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastScraped) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [lastScraped]);

  if (!lastScraped) return null;

  const diffMs = Date.now() - new Date(lastScraped).getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  let colorClass = "text-muted-foreground";
  let dotClass = "bg-primary/50";
  if (diffHours > 6) {
    colorClass = "text-destructive";
    dotClass = "bg-destructive";
  } else if (diffHours > 1) {
    colorClass = "text-yellow-500";
    dotClass = "bg-yellow-500";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono ${colorClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass} ${diffHours <= 1 ? "animate-pulse" : ""}`} />
      Data updated {formatTimeAgo(lastScraped)}
    </span>
  );
});
DataFreshnessIndicator.displayName = "DataFreshnessIndicator";

const TIME_RANGES = ["24h", "7d", "30d"] as const;
const TIME_RANGE_LABELS: Record<string, string> = {
  "24h": "Show last 24 hours",
  "7d": "Show last 7 days",
  "30d": "Show last 30 days",
};

const ModelDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const [timeRange, setTimeRange] = useState<typeof TIME_RANGES[number]>("30d");

  const { data: model, isLoading: modelLoading } = useModelDetail(slug);
  const { data: allModels } = useModelsWithLatestVibes();
  const period = timeRange === "24h" ? "hourly" : "daily";
  const { data: vibesHistory, isLoading: historyLoading, isError: historyError } = useVibesHistory(model?.id, period, timeRange);
  const { data: complaints, isLoading: complaintsLoading, isError: complaintsError } = useComplaintBreakdown(model?.id);
  const { data: sources, isLoading: sourcesLoading, isError: sourcesError } = useSourceBreakdown(model?.id);

  const { data: recentPosts, isLoading: postsLoading, isError: postsError } = useModelPosts(model?.id, 25);

  const enriched = allModels?.find((m) => m.slug === slug);
  const latestScore = enriched?.latestScore ?? 50;
  const trend = enriched?.trend ?? { direction: "up" as const, pts: 0 };
  const totalPosts = enriched?.totalPosts ?? 0;
  const vibe = getVibeStatus(latestScore);
  const VibeIcon = vibe.icon;
  const accent = model?.accent_color || "#888";

  useHead({
    title: model ? `${model.name} Vibes — LLM Vibes` : "Loading — LLM Vibes",
    description: model
      ? `Real-time community sentiment and complaint trends for ${model.name}.`
      : undefined,
    url: slug ? `/model/${slug}` : undefined,
  });

  if (modelLoading) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background">
          <NavBar />
          <section className="container pt-10 pb-8">
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-32 bg-secondary/60 rounded" />
              <div className="h-10 w-48 bg-secondary/60 rounded" />
              <div className="h-16 w-32 bg-secondary/60 rounded" />
            </div>
          </section>
        </div>
      </PageTransition>
    );
  }

  if (!model) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground mb-4">Model not found</p>
            <Link to="/dashboard">
              <Button variant="outline" className="font-mono text-sm">Back to Dashboard</Button>
            </Link>
          </div>
        </div>
      </PageTransition>
    );
  }

  const chartData = (vibesHistory || []).map((v, i, arr) => {
    const isLast = i === arr.length - 1;
    const date = new Date(v.period_start);
    let label: string;
    if (isLast) {
      label = timeRange === "24h" ? "Now" : "Today";
    } else if (timeRange === "24h") {
      const h = date.getHours();
      const suffix = h >= 12 ? "pm" : "am";
      const h12 = h % 12 || 12;
      label = `${h12}${suffix}`;
    } else {
      label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return { day: label, score: v.score };
  });

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />

        {/* Model Header */}
        <section className="container pt-10 pb-8">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <Link to="/dashboard" aria-label="Back to Dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Link>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-1.5 rounded-full" style={{ background: accent }} />
                <h1 className="text-3xl sm:text-4xl font-bold text-foreground">{model.name}</h1>
              </div>
              <div className="flex items-center gap-2">
                <VibeIcon className="h-5 w-5" style={{ color: vibe.color }} />
                <span className="font-mono text-sm" style={{ color: vibe.color }}>{vibe.label}</span>
              </div>
            </div>
            <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-4">
              <p className="text-6xl font-bold font-mono text-foreground" style={{ textShadow: `0 0 30px ${vibe.color}40, 0 0 60px ${vibe.color}15` }}>{latestScore}<span className="text-xl text-muted-foreground ml-1">/ 100</span></p>
              <div className="flex items-center gap-2 pb-2">
                {trend.direction === "up" ? (
                  <TrendingUp className="h-4 w-4 text-primary" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-destructive" />
                )}
                <span className={`text-sm font-mono ${trend.direction === "up" ? "text-primary" : "text-destructive"}`}>
                  {trend.direction === "up" ? "up" : "down"} {trend.pts} pts from yesterday
                </span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-sm text-muted-foreground font-mono">
                Sentiment based on {totalPosts.toLocaleString()} posts over the last 7 days across Bluesky, Mastodon, and Hacker News.
              </p>
              <DataFreshnessIndicator />
            </div>
          </motion.div>
        </section>

        {/* Main Content: Two Columns */}
        <section className="container pb-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column — Chart */}
            <motion.div
              className="lg:col-span-2 glass rounded-xl p-6 self-start"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.45 }}
            >
              {historyError ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Failed to load data</p>
              ) : historyLoading ? (
                <ChartSkeleton />
              ) : (
                <>
                  <h2 className="text-lg font-semibold text-foreground mb-1">Vibes Over Time</h2>
                  <p className="text-xs text-muted-foreground font-mono mb-4">
                    {timeRange === "24h" ? "Hourly" : "Daily"} vibes score
                  </p>
                  <div className="h-64">
                    <Suspense fallback={<div className="h-64 animate-pulse rounded bg-secondary/40" />}>
                      <LazyVibesChart chartData={chartData} accent={accent} timeRange={timeRange} />
                    </Suspense>
                  </div>
                  <div className="mt-4 flex gap-2">
                    {TIME_RANGES.map((r) => (
                      <button
                        key={r}
                        onClick={() => setTimeRange(r)}
                        aria-label={TIME_RANGE_LABELS[r]}
                        className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                          timeRange === r
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </motion.div>

            {/* Right Column — Complaints + Sources */}
            <div className="space-y-6">
              <motion.div
                className="glass rounded-xl p-6"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.45 }}
              >
                <h2 className="text-lg font-semibold text-foreground mb-4">Complaint Breakdown</h2>
                {complaintsError ? (
                  <p className="text-sm text-muted-foreground">Failed to load data</p>
                ) : complaintsLoading ? (
                  <BarsSkeleton count={5} />
                ) : complaints && complaints.length > 0 ? (
                  <div className="space-y-3">
                    {complaints.map((c) => (
                      <div key={c.category}>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-muted-foreground">{COMPLAINT_LABELS[c.category] || c.category}</span>
                          <span className="text-foreground">{c.pct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${c.pct}%`, background: accent }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No complaint data yet</p>
                )}
              </motion.div>

              <motion.div
                className="glass rounded-xl p-6"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.45 }}
              >
                <h2 className="text-lg font-semibold text-foreground mb-4">Sources</h2>
                {sourcesError ? (
                  <p className="text-sm text-muted-foreground">Failed to load data</p>
                ) : sourcesLoading ? (
                  <BarsSkeleton count={3} />
                ) : sources && sources.filter((s) => s.pct > 0).length > 0 ? (
                  <div className="space-y-3">
                    {sources.filter((s) => s.pct > 0).map((s) => (
                      <div key={s.source}>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-muted-foreground">{SOURCE_LABELS[s.source] || s.source}</span>
                          <span className="text-foreground">{s.pct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${s.pct}%`, background: accent, opacity: 0.7 }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No source data yet</p>
                )}
              </motion.div>
            </div>
          </div>
        </section>

        {/* Recent Posts — lazy loaded on scroll */}
        <section className="container pb-12">
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="text-xl font-bold text-foreground mb-6"
          >
            Recent Posts about {model.name}
          </motion.h2>

          {postsError ? (
            <p className="text-sm text-muted-foreground text-center py-8">Failed to load data</p>
          ) : postsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <ChatterSkeleton key={i} />)}
            </div>
          ) : (
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
              className="space-y-3"
            >
              {(recentPosts || []).map((post, i) => {
                const s = SENTIMENT_STYLES[post.sentiment || "neutral"];
                const src = formatSourceDisplay(post.source);
                return (
                  <motion.div
                    key={post.id}
                    variants={fadeUp}
                    custom={i}
                    className={`glass rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-l-2 ${post.sentiment === "positive" ? "border-l-emerald-500" : post.sentiment === "negative" ? "border-l-red-500" : "border-l-muted-foreground/30"} transition-all duration-200 ${post.source_url ? "cursor-pointer hover:brightness-125 hover:border-border/60" : ""}`}
                    onClick={() => post.source_url && window.open(post.source_url, "_blank", "noopener,noreferrer")}
                  >
                    <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 rounded bg-secondary border border-border shrink-0">
                      {src.emoji} {src.label}
                    </span>
                    <p className="text-sm text-foreground/80 flex-1 leading-relaxed line-clamp-2">
                      {decodeHTMLEntities((post as any).translated_content || post.content || post.title)}
                      {(post as any).original_language && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-1.5 inline-flex items-center text-[10px] font-mono text-muted-foreground/60 bg-secondary/50 px-1 py-0.5 rounded border border-border/30 cursor-help whitespace-nowrap">
                              Translated from {((post as any).original_language as string).toUpperCase()}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm">
                            <p className="text-xs">{decodeHTMLEntities(post.content?.slice(0, 300) || "")}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${s.classes}`}>
                        {s.label}
                      </Badge>
                      {post.posted_at && (
                        <span className="text-xs text-muted-foreground font-mono">{formatTimeAgo(post.posted_at)}</span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </section>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default ModelDetail;
