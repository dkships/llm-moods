import { useParams, Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Minus, ArrowLeft, ArrowRight, BookOpen, ExternalLink, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, lazy, Suspense } from "react";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import Surface from "@/components/Surface";
import SectionHeader from "@/components/SectionHeader";
import FilterChip from "@/components/FilterChip";
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
  getVibeStatus, formatComplaintLabel, SOURCE_LABELS,
  SENTIMENT_STYLES, formatTimeAgo, formatSourceDisplay, decodeHTMLEntities,
  sentimentBorderClass,
} from "@/lib/vibes";
import { ChartSkeleton, BarsSkeleton, ChatterSkeleton } from "@/components/Skeletons";

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
  const recentPosts7d = enriched?.recentPosts7d ?? enriched?.totalPosts ?? 0;
  const latestScoreTotalPosts = enriched?.latestScoreTotalPosts ?? 0;
  const latestEligiblePosts = enriched?.eligiblePosts ?? 0;
  const scoreBasisStatus = enriched?.scoreBasisStatus ?? "measured";
  const latestDataUpdatedAt = enriched?.latestPostIngestedAt ?? enriched?.latestPostPostedAt ?? null;
  const scoreComputedAt = enriched?.scoreComputedAt ?? null;
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
  const latestRecentPostAt = postsWithSurface[0]?.post.posted_at ?? null;

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

  const trendDown = !enriched?.isLatestCarryForward && trend.direction === "down";
  const trendUp = !enriched?.isLatestCarryForward && trend.direction === "up";

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          {/* Model Header */}
          <section className="container pt-10 pb-8 animate-fade-in">
            <Link
              to="/dashboard"
              className="mb-6 inline-flex items-center gap-1.5 rounded-md text-sm text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
              <p className="text-5xl sm:text-6xl font-bold font-mono text-foreground" style={{ textShadow: `0 0 30px ${vibe.color}40, 0 0 60px ${vibe.color}15` }}>{latestScore}<span className="text-xl text-text-tertiary ml-1">/ 100</span></p>
              <div className="flex items-center gap-2 pb-2">
                {trendUp ? (
                  <TrendingUp className="h-4 w-4 text-primary" />
                ) : trendDown ? (
                  <TrendingDown className="h-4 w-4 text-destructive" />
                ) : (
                  <Minus className="h-4 w-4 text-text-tertiary" />
                )}
                <span
                  className={`text-sm font-mono ${
                    trendUp
                      ? "text-primary"
                      : trendDown
                      ? "text-destructive"
                      : "text-text-tertiary"
                  }`}
                >
                  {enriched?.isLatestCarryForward
                    ? "no scored posts in the latest window. Showing the previous daily score."
                    : trend.direction === "flat"
                    ? "no change from yesterday"
                    : `${trendUp ? "up" : "down"} ${trend.pts} pts from yesterday`}
                </span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-sm text-text-tertiary font-mono">
                Daily score based on {latestEligiblePosts.toLocaleString()} scored posts in the latest scoring window. 7-day chatter: {recentPosts7d.toLocaleString()} posts across Reddit, Hacker News, Bluesky, Mastodon, and X.
              </p>
              <DataFreshnessIndicator lastUpdated={latestDataUpdatedAt} />
              {scoreComputedAt && (
                <span
                  className="text-xs sm:text-[11px] font-mono text-text-tertiary"
                  title={`Score computed at ${new Date(scoreComputedAt).toLocaleString()}`}
                >
                  Score recalculated {formatTimeAgo(scoreComputedAt)}
                </span>
              )}
            </div>
            {!enriched?.isLatestCarryForward && scoreBasisStatus === "no_eligible_posts" && latestScoreTotalPosts > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-text-tertiary font-mono">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                Posts were found in the latest window, but none met the high-confidence scoring threshold.
              </p>
            )}
            {!enriched?.isLatestCarryForward
              && latestEligiblePosts > 0
              && latestEligiblePosts < 5 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-text-tertiary font-mono">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                Limited sample in the latest window. Only {latestEligiblePosts} high-confidence posts back this score.
              </p>
            )}
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
                  <Surface
                    as="article"
                    size="tight"
                    tone="accent"
                    motion="fade"
                    className="flex items-center gap-4 sm:gap-5"
                  >
                    <BookOpen className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs uppercase tracking-wide text-text-tertiary">
                        Recent incident analysis
                      </p>
                      <p className="mt-1 font-display text-sm font-semibold text-foreground sm:truncate sm:text-base">
                        {featured.title}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  </Surface>
                </Link>
              </section>
            );
          })()}

          {/* Main Content: Two Columns */}
          <section className="container pb-12">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column — Chart + Official Status stacked */}
              <div className="lg:col-span-2 space-y-6">
                <Surface motion="fade">
                  {historyError ? (
                    <p className="py-8 text-center text-sm text-text-tertiary" role="status" aria-live="polite">
                      Failed to load data
                    </p>
                  ) : historyLoading ? (
                    <ChartSkeleton />
                  ) : (
                    <>
                      <SectionHeader
                        title="Vibes Over Time"
                        meta={timeRange === "24h" ? "Hourly vibes score" : "Daily vibes score"}
                      />
                      <div className="h-64">
                        <Suspense fallback={<div className="h-64 animate-pulse rounded bg-secondary/40" />}>
                          <LazyVibesChart chartData={chartData} accent={accent} timeRange={timeRange} events={chartEvents} />
                        </Suspense>
                      </div>
                      <div className="mt-4 flex gap-2">
                        {TIME_RANGES.map((r) => (
                          <FilterChip
                            key={r}
                            variant="rect"
                            pressed={timeRange === r}
                            onClick={() => setTimeRange(r)}
                            title={`Show ${r}`}
                          >
                            {r}
                          </FilterChip>
                        ))}
                      </div>
                      {chartEvents.length > 0 && (
                        <div className="mt-4 border-t border-border/40 pt-3">
                          <p className="mb-2 font-mono text-xs text-text-tertiary">Known events on this chart</p>
                          <ul className="space-y-1">
                            {chartEvents.map((evt, i) => (
                              <li key={`legend-${i}`} className="flex items-center gap-2 text-xs">
                                <span
                                  className="inline-block h-2 w-3 shrink-0 rounded-sm"
                                  style={{ background: evt.color, opacity: 0.7 }}
                                  aria-hidden="true"
                                />
                                <span className="text-text-secondary">{evt.title}</span>
                                <span className="font-mono text-text-tertiary">
                                  {evt.startLabel}{evt.endLabel ? ` → ${evt.endLabel}` : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </Surface>

                <StatusCard modelSlug={slug ?? ""} />
              </div>

              {/* Right Column — Negative-by-surface (conditional) + Complaints + Sources */}
              <div className="space-y-6">
                {negativeSurfaceRows.length > 0 && (
                  <Surface motion="fade">
                    <SectionHeader
                      title="Negative posts by surface"
                      meta="Loaded 7-day recent-post window"
                    />
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
                      {negativeSurfaceRows.map((row, i) => {
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
                          className="flex justify-between font-mono text-xs text-text-tertiary"
                        >
                          <span>{row.label}</span>
                          <span>{row.pct}%</span>
                        </li>
                      ))}
                    </ul>
                  </Surface>
                )}

                <Surface motion="fade">
                  <SectionHeader title="Complaint Breakdown" meta="Last 30 days" />
                  {complaintsError ? (
                    <p className="text-sm text-text-tertiary" role="status" aria-live="polite">Failed to load data</p>
                  ) : complaintsLoading ? (
                    <BarsSkeleton count={5} />
                  ) : complaints && complaints.length > 0 ? (
                    <div className="space-y-3">
                      {complaints.map((c) => (
                        <div key={c.category}>
                          <div className="flex justify-between text-xs font-mono mb-1">
                            <span className="text-text-tertiary">{formatComplaintLabel(c.category)}</span>
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
                    <p className="text-sm text-text-tertiary">No complaint data yet</p>
                  )}
                </Surface>

                <Surface motion="fade">
                  <SectionHeader title="Sources" meta="Share of posts over the last 30 days" />
                  {sourcesError ? (
                    <p className="text-sm text-text-tertiary" role="status" aria-live="polite">Failed to load data</p>
                  ) : sourcesLoading ? (
                    <BarsSkeleton count={3} />
                  ) : sources && sources.filter((s) => s.pct > 0).length > 0 ? (
                    <div className="space-y-3">
                      {sources.filter((s) => s.pct > 0).map((s) => (
                        <div key={s.source}>
                          <div className="flex justify-between text-xs font-mono mb-1">
                            <span className="text-text-tertiary">{SOURCE_LABELS[s.source] || s.source}</span>
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
                    <p className="text-sm text-text-tertiary">No source data yet</p>
                  )}
                </Surface>
              </div>
            </div>
          </section>

          {/* Recent Posts */}
          <section className="container pb-12">
            <SectionHeader
              level="page"
              title={`Recent Posts about ${model.name}`}
              meta={latestRecentPostAt ? `Latest classified post ${formatTimeAgo(latestRecentPostAt)}` : undefined}
              className="mb-3"
            />
            {availableSurfaceLabels.length > 0 && (
              <div
                className="mb-6 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
                role="group"
                aria-label="Filter recent posts by product surface"
              >
                <FilterChip
                  variant="pill"
                  pressed={surfaceFilter === "all"}
                  onClick={() => setSurfaceFilter("all")}
                >
                  All ({postsWithSurface.length})
                </FilterChip>
                {availableSurfaceLabels.map((label) => (
                  <FilterChip
                    key={label}
                    variant="pill"
                    pressed={surfaceFilter === label}
                    onClick={() => setSurfaceFilter(label)}
                  >
                    {label} ({surfaceCounts.get(label) ?? 0})
                  </FilterChip>
                ))}
              </div>
            )}

            {postsError ? (
              <p className="py-8 text-center text-sm text-text-tertiary" role="status" aria-live="polite">
                Failed to load data
              </p>
            ) : postsLoading ? (
              <div className="space-y-3" role="status" aria-live="polite">
                {Array.from({ length: 5 }).map((_, i) => <ChatterSkeleton key={i} />)}
              </div>
            ) : filteredPostsWithSurface.length === 0 && surfaceFilter !== "all" ? (
              <p className="py-8 text-center text-sm text-text-tertiary">
                No recent posts match the {surfaceFilter} filter. Try another surface.
              </p>
            ) : filteredPostsWithSurface.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-tertiary">
                No posts in the last 7 days.
              </p>
            ) : (
              <div className="space-y-3">
                {filteredPostsWithSurface.map(({ post, surface }) => {
                  const sentiment = post.sentiment || "neutral";
                  const s = SENTIMENT_STYLES[sentiment];
                  const src = formatSourceDisplay(post.source);
                  const cardClasses = `flex flex-col sm:flex-row sm:items-center gap-3 border-l-2 ${sentimentBorderClass(sentiment)}`;
                  const linkClasses = post.source_url
                    ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    : "";

                  const content = (
                    <>
                      <span className="text-xs font-mono text-foreground px-2 py-0.5 rounded bg-secondary border border-border shrink-0">
                        {src.emoji} {src.label}
                      </span>
                      {surface && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono px-1.5 py-0 shrink-0 text-text-tertiary border-border bg-secondary/40"
                          title="Detected from post text"
                        >
                          {surface.label}
                        </Badge>
                      )}
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
                            className="text-xs text-text-tertiary font-mono"
                            title={`Posted on ${src.label} at ${new Date(post.posted_at).toLocaleString()}`}
                          >
                            {formatTimeAgo(post.posted_at)}
                          </span>
                        )}
                        {post.source_url && <ExternalLink className="h-3 w-3 text-text-tertiary shrink-0" />}
                      </div>
                    </>
                  );

                  return post.source_url ? (
                    <Surface
                      key={post.id}
                      as="a"
                      size="compact"
                      motion="fade"
                      href={post.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${cardClasses} ${linkClasses}`.trim()}
                    >
                      {content}
                    </Surface>
                  ) : (
                    <Surface
                      key={post.id}
                      size="compact"
                      motion="fade"
                      className={cardClasses}
                    >
                      {content}
                    </Surface>
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
