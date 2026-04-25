import { useParams, Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Minus, ArrowLeft, ArrowRight, BookOpen, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, lazy, Suspense } from "react";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import useHead from "@/hooks/useHead";
import Footer from "@/components/Footer";
import {
  useModelDetail, useVibesHistory, useComplaintBreakdown,
  useSourceBreakdown, useModelPosts, useModelsWithLatestVibes,
} from "@/hooks/useVibesData";
import { getResearchPostsForModel } from "@/data/research-posts";
import { detectProductSurface } from "@/lib/product-surface";
import StatusCard from "@/components/StatusCard";
import DataFreshnessIndicator from "@/components/DataFreshnessIndicator";
import { useDailyChartData, useChartEvents } from "@/lib/use-chart-data";
import {
  getVibeStatus, fadeUp, formatComplaintLabel, SOURCE_LABELS,
  SENTIMENT_STYLES, formatTimeAgo, formatSourceDisplay, decodeHTMLEntities,
} from "@/lib/vibes";
import { ChartSkeleton, BarsSkeleton, ChatterSkeleton } from "@/components/Skeletons";

// Lazy load the heavy chart component
const LazyVibesChart = lazy(() => import("@/components/VibesChart"));

const TIME_RANGES = ["24h", "7d", "30d"] as const;

const ModelDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const [timeRange, setTimeRange] = useState<typeof TIME_RANGES[number]>("30d");
  const [surfaceFilter, setSurfaceFilter] = useState<string>("all");

  const { data: fetchedModel, isLoading: modelLoading } = useModelDetail(slug);
  const { data: allModels } = useModelsWithLatestVibes();
  const enriched = allModels?.find((m) => m.slug === slug);

  // Synthesize a model from the dashboard cache while useModelDetail is in flight.
  // This eliminates the full-page skeleton stutter on Dashboard → ModelDetail
  // navigation; the dedicated query still resolves and replaces this when it lands.
  const model = fetchedModel ?? (enriched ? {
    id: enriched.id,
    name: enriched.name,
    slug: enriched.slug,
    accent_color: enriched.accent_color,
  } as typeof fetchedModel : null);

  const period = timeRange === "24h" ? "hourly" : "daily";
  const { data: vibesHistory, isLoading: historyLoading, isError: historyError } = useVibesHistory(model?.id, period, timeRange);
  const { data: complaints, isLoading: complaintsLoading, isError: complaintsError } = useComplaintBreakdown(model?.id);
  const { data: sources, isLoading: sourcesLoading, isError: sourcesError } = useSourceBreakdown(model?.id);

  const { data: recentPosts, isLoading: postsLoading, isError: postsError } = useModelPosts(model?.id, 25);


  const latestScore = enriched?.latestScore ?? 50;
  const trend = enriched?.trend ?? { direction: "up" as const, pts: 0 };
  const totalPosts = enriched?.totalPosts ?? 0;
  const vibe = getVibeStatus(latestScore);
  const VibeIcon = vibe.icon;
  const accent = model?.accent_color || "#888";

  // Lexical product-surface tagging on recent posts. Same regex map applies to all four
  // tracked models — see src/lib/product-surface.ts for per-model patterns.
  const postsWithSurface = (recentPosts || []).map((post) => ({
    post,
    surface: detectProductSurface(slug ?? "", `${post.title || ""} ${post.content || ""}`),
  }));

  const surfaceCounts = new Map<string, number>();
  for (const { surface } of postsWithSurface) {
    if (!surface) continue;
    surfaceCounts.set(surface.label, (surfaceCounts.get(surface.label) ?? 0) + 1);
  }
  const availableSurfaceLabels = Array.from(surfaceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);

  const filteredPostsWithSurface = surfaceFilter === "all"
    ? postsWithSurface
    : postsWithSurface.filter(({ surface }) => surface?.label === surfaceFilter);

  // Surface distribution among negative posts in the loaded recent window.
  const negativeBySurface = new Map<string, number>();
  let totalNegativePosts = 0;
  for (const { post, surface } of postsWithSurface) {
    if (post.sentiment !== "negative") continue;
    totalNegativePosts++;
    const key = surface?.label ?? "Unknown";
    negativeBySurface.set(key, (negativeBySurface.get(key) ?? 0) + 1);
  }
  const negativeSurfaceRows = Array.from(negativeBySurface.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label,
      count,
      pct: totalNegativePosts > 0 ? Math.round((count / totalNegativePosts) * 100) : 0,
    }));

  useHead({
    title: model ? `${model.name} Vibes — LLM Vibes` : "Loading — LLM Vibes",
    description: model
      ? `Latest community sentiment and complaint trends for ${model.name}.`
      : undefined,
    url: slug ? `/model/${slug}` : undefined,
  });

  // Daily chart hooks must run unconditionally (above any early-return) to
  // satisfy the rules of hooks. The values are unused on the loading/not-found
  // paths but the calls themselves still have to happen each render.
  const dailyChart = useDailyChartData(vibesHistory, timeRange === "7d" ? 7 : 30);
  const dailyEvents = useChartEvents(slug ?? "", dailyChart.dateLabels);

  if (!model && modelLoading) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background">
          <NavBar />
          <main id="main-content" tabIndex={-1} className="scroll-mt-24">
            <section className="container pt-10 pb-8">
              <div className="animate-pulse space-y-4" role="status" aria-live="polite">
                <div className="h-4 w-32 bg-secondary/60 rounded" />
                <div className="h-10 w-48 bg-secondary/60 rounded" />
                <div className="h-16 w-32 bg-secondary/60 rounded" />
              </div>
            </section>
          </main>
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
            <Button asChild variant="outline" className="font-mono text-sm">
              <Link to="/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>
      </PageTransition>
    );
  }

  // The 24h hourly path uses different label semantics ("3pm", "Now") and has
  // no event overlay — so we keep its derivation inline rather than forcing it
  // through the daily hook.
  const { chartData, chartEvents } = (() => {
    if (timeRange !== "24h") {
      return { chartData: dailyChart.chartData, chartEvents: dailyEvents };
    }
    const history = vibesHistory || [];
    const data = history.map((v, i, arr) => {
      const date = new Date(v.period_start);
      const now = new Date();
      const isLast = i === arr.length - 1;
      const isRecent = isLast && (now.getTime() - date.getTime()) < 2 * 60 * 60 * 1000;
      let label: string;
      if (isRecent) {
        label = "Now";
      } else {
        const h = date.getHours();
        const suffix = h >= 12 ? "pm" : "am";
        const h12 = h % 12 || 12;
        label = `${h12}${suffix}`;
      }
      return { day: label, score: v.score };
    });
    return { chartData: data, chartEvents: [] as ReturnType<typeof useChartEvents> };
  })();

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          {/* Model Header */}
          <section className="container pt-10 pb-8">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <Link
                to="/dashboard"
                className="mb-6 inline-flex items-center gap-1.5 rounded-md text-sm text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
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
                <p className="text-5xl sm:text-6xl font-bold font-mono text-foreground" style={{ textShadow: `0 0 30px ${vibe.color}40, 0 0 60px ${vibe.color}15` }}>{latestScore}<span className="text-xl text-foreground/65 ml-1">/ 100</span></p>
                <div className="flex items-center gap-2 pb-2">
                  {trend.direction === "up" ? (
                    <TrendingUp className="h-4 w-4 text-primary" />
                  ) : trend.direction === "down" ? (
                    <TrendingDown className="h-4 w-4 text-red-200" />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span
                    className={`text-sm font-mono ${
                      trend.direction === "up"
                        ? "text-primary"
                        : trend.direction === "down"
                        ? "text-red-200"
                        : "text-muted-foreground"
                    }`}
                  >
                    {trend.direction === "flat"
                      ? "no change from yesterday"
                      : `${trend.direction === "up" ? "up" : "down"} ${trend.pts} pts from yesterday`}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <p className="text-sm text-foreground/70 font-mono">
                  Latest daily score with {totalPosts.toLocaleString()} recent posts over the last 7 days across Reddit, Bluesky, X, Mastodon, and more.
                </p>
                <DataFreshnessIndicator lastUpdated={enriched?.lastUpdated ?? null} />
              </div>
            </motion.div>
          </section>

          {/* Recent incident analysis — only when a research post references this model */}
          {(() => {
            const relatedPosts = getResearchPostsForModel(slug ?? "");
            if (relatedPosts.length === 0) return null;
            const featured = relatedPosts[0];
            return (
              <section className="container pb-6">
                <Link
                  to={`/research/${featured.slug}`}
                  className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`Read research analysis: ${featured.title}`}
                >
                  <motion.article
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05, duration: 0.4 }}
                    className="glass flex items-center gap-4 rounded-xl border-l-2 border-l-primary p-5 transition-colors hover:bg-secondary/30 sm:gap-5"
                  >
                    <BookOpen className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs uppercase tracking-wide text-foreground/65">
                        Recent incident analysis
                      </p>
                      <p className="mt-1 font-display text-sm font-semibold text-foreground sm:truncate sm:text-base">
                        {featured.title}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  </motion.article>
                </Link>
              </section>
            );
          })()}

          {/* Main Content: Two Columns */}
          <section className="container pb-12">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column — Chart + Official Status stacked */}
            <div className="lg:col-span-2 space-y-6">
            <motion.div
              className="glass rounded-xl p-6"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.45 }}
            >
              {historyError ? (
                <p className="py-8 text-center text-sm text-muted-foreground" role="status" aria-live="polite">
                  Failed to load data
                </p>
              ) : historyLoading ? (
                <ChartSkeleton />
              ) : (
                <>
                  <h2 className="text-lg font-semibold text-foreground mb-1">Vibes Over Time</h2>
                  <p className="text-xs text-foreground/70 font-mono mb-4">
                    {timeRange === "24h" ? "Hourly" : "Daily"} vibes score
                  </p>
                  <div className="h-64">
                    <Suspense fallback={<div className="h-64 animate-pulse rounded bg-secondary/40" />}>
                      <LazyVibesChart chartData={chartData} accent={accent} timeRange={timeRange} events={chartEvents} />
                    </Suspense>
                  </div>
                  <div className="mt-4 flex gap-2">
                    {TIME_RANGES.map((r) => (
                      <button
                        key={r}
                        onClick={() => setTimeRange(r)}
                        title={`Show ${r}`}
                        aria-pressed={timeRange === r}
                        className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                          timeRange === r
                            ? "bg-primary/15 text-primary border border-primary/30"
                            : "text-foreground/70 hover:text-foreground hover:bg-secondary/50"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {chartEvents.length > 0 && (
                    <div className="mt-4 border-t border-border/40 pt-3">
                      <p className="mb-2 font-mono text-xs text-foreground/65">Known events on this chart</p>
                      <ul className="space-y-1">
                        {chartEvents.map((evt, i) => (
                          <li key={`legend-${i}`} className="flex items-center gap-2 text-xs">
                            <span
                              className="inline-block h-2 w-3 shrink-0 rounded-sm"
                              style={{ background: evt.color, opacity: 0.7 }}
                              aria-hidden="true"
                            />
                            <span className="text-foreground/80">{evt.title}</span>
                            <span className="font-mono text-foreground/50">
                              {evt.startLabel}{evt.endLabel ? ` → ${evt.endLabel}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </motion.div>

              <StatusCard modelSlug={slug ?? ""} />
            </div>

            {/* Right Column — Complaints + Sources */}
            <div className="space-y-6">
              <motion.div
                className="glass rounded-xl p-6"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.45 }}
              >
                {negativeSurfaceRows.length > 0 && (
                  <div className="mb-5 border-b border-border/40 pb-4">
                    <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-foreground/65">
                      Negative posts by surface
                    </h3>
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
                      {negativeSurfaceRows.map((row, i) => {
                        // Fixed opacity ramp so 5+ surfaces stay legible.
                        // Index 0 is the largest segment, leading the bar.
                        const ramp = [0.85, 0.65, 0.45, 0.3, 0.2];
                        return (
                          <div
                            key={row.label}
                            className="h-full"
                            style={{
                              width: `${row.pct}%`,
                              background: accent,
                              opacity: ramp[Math.min(i, ramp.length - 1)],
                            }}
                            title={`${row.label}: ${row.count} (${row.pct}%)`}
                          />
                        );
                      })}
                    </div>
                    <ul className="mt-2 space-y-0.5">
                      {negativeSurfaceRows.map((row) => (
                        <li
                          key={row.label}
                          className="flex justify-between font-mono text-xs text-foreground/70"
                        >
                          <span>{row.label}</span>
                          <span>{row.pct}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <h2 className="text-lg font-semibold text-foreground mb-4">Complaint Breakdown</h2>
                {complaintsError ? (
                  <p className="text-sm text-muted-foreground" role="status" aria-live="polite">Failed to load data</p>
                ) : complaintsLoading ? (
                  <BarsSkeleton count={5} />
                ) : complaints && complaints.length > 0 ? (
                  <div className="space-y-3">
                    {complaints.map((c) => (
                      <div key={c.category}>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-foreground/70">{formatComplaintLabel(c.category)}</span>
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
                <p className="text-xs text-foreground/65 font-mono mb-4">Share of recent posts over the last 30 days</p>
                {sourcesError ? (
                  <p className="text-sm text-muted-foreground" role="status" aria-live="polite">Failed to load data</p>
                ) : sourcesLoading ? (
                  <BarsSkeleton count={3} />
                ) : sources && sources.filter((s) => s.pct > 0).length > 0 ? (
                  <div className="space-y-3">
                    {sources.filter((s) => s.pct > 0).map((s) => (
                      <div key={s.source}>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-foreground/70">{SOURCE_LABELS[s.source] || s.source}</span>
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
              className="text-xl font-bold text-foreground mb-3"
            >
              Recent Posts about {model.name}
            </motion.h2>
            {availableSurfaceLabels.length > 0 && (
              <div
                className="mb-6 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
                role="group"
                aria-label="Filter recent posts by product surface"
              >
                <button
                  type="button"
                  onClick={() => setSurfaceFilter("all")}
                  aria-pressed={surfaceFilter === "all"}
                  className={`shrink-0 rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
                    surfaceFilter === "all"
                      ? "border-primary/30 bg-primary/15 text-primary"
                      : "border-border text-foreground/70 hover:bg-secondary/50 hover:text-foreground"
                  }`}
                >
                  All ({postsWithSurface.length})
                </button>
                {availableSurfaceLabels.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setSurfaceFilter(label)}
                    aria-pressed={surfaceFilter === label}
                    className={`shrink-0 rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
                      surfaceFilter === label
                        ? "border-primary/30 bg-primary/15 text-primary"
                        : "border-border text-foreground/70 hover:bg-secondary/50 hover:text-foreground"
                    }`}
                  >
                    {label} ({surfaceCounts.get(label) ?? 0})
                  </button>
                ))}
              </div>
            )}

            {postsError ? (
              <p className="py-8 text-center text-sm text-muted-foreground" role="status" aria-live="polite">
                Failed to load data
              </p>
            ) : postsLoading ? (
              <div className="space-y-3" role="status" aria-live="polite">
                {Array.from({ length: 5 }).map((_, i) => <ChatterSkeleton key={i} />)}
              </div>
            ) : filteredPostsWithSurface.length === 0 && surfaceFilter !== "all" ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No recent posts match the {surfaceFilter} filter. Try another surface.
              </p>
            ) : (
              <div className="space-y-3">
                {filteredPostsWithSurface.map(({ post, surface }, i) => {
                  const s = SENTIMENT_STYLES[post.sentiment || "neutral"];
                  const src = formatSourceDisplay(post.source);
                  const className = `glass rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-l-2 ${post.sentiment === "positive" ? "border-l-emerald-500" : post.sentiment === "negative" ? "border-l-red-500" : "border-l-muted-foreground/30"} transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${post.source_url ? "cursor-pointer hover:brightness-125 hover:border-border/60" : ""}`;
                  const content = (
                    <>
                      <span className="text-xs font-mono text-foreground px-2 py-0.5 rounded bg-secondary border border-border shrink-0">
                        {src.emoji} {src.label}
                      </span>
                      {surface && (
                        <span
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0"
                          style={{ borderColor: `${accent}55`, color: accent, background: `${accent}15` }}
                          title="Detected from post text"
                        >
                          {surface.label}
                        </span>
                      )}
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
                              <p className="text-xs">{decodeHTMLEntities(post.content?.slice(0, 300) || "")}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </p>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${s.classes}`}>
                          {s.label}
                        </Badge>
                        {post.posted_at && (
                          <span
                            className="text-xs text-foreground font-mono"
                            title={`Posted on ${src.label} at ${new Date(post.posted_at).toLocaleString()}`}
                          >
                            {formatTimeAgo(post.posted_at)}
                          </span>
                        )}
                        {post.source_url && <ExternalLink className="h-3 w-3 text-foreground/50 shrink-0" />}
                      </div>
                    </>
                  );

                  return post.source_url ? (
                    <motion.a
                      key={post.id}
                      variants={fadeUp}
                      custom={i}
                      className={className}
                      href={post.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {content}
                    </motion.a>
                  ) : (
                    <motion.div
                      key={post.id}
                      variants={fadeUp}
                      custom={i}
                      className={className}
                    >
                      {content}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default ModelDetail;
