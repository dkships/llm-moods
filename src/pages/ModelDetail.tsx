import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, lazy, Suspense } from "react";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import Surface from "@/components/Surface";
import SectionHeader from "@/components/SectionHeader";
import FilterChip from "@/components/FilterChip";
import ChatterPost from "@/components/ChatterPost";
import useHead from "@/hooks/useHead";
import Footer from "@/components/Footer";
import {
  useModelDetail, useVibesHistory, useComplaintBreakdown,
  useSourceBreakdown, useModelPosts, useModelsWithLatestVibes,
} from "@/hooks/useVibesData";
import { getResearchPostsForModel } from "@/data/research-posts";
import { detectProductSurface } from "@/lib/product-surface";
import StatusCard from "@/components/StatusCard";
import BarList from "@/components/BarList";
import { useDailyChartData, useChartEvents } from "@/lib/use-chart-data";
import {
  getVibeStatus, formatComplaintLabel, SOURCE_LABELS,
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
  const latestEligiblePosts = enriched?.eligiblePosts ?? 0;
  const failedPosts = enriched?.failedPosts ?? 0;
  const metaParts = [
    `${latestEligiblePosts.toLocaleString()} SCORED`,
    `${recentPosts7d.toLocaleString()} COLLECTED`,
    "7D",
    failedPosts > 0 ? `${failedPosts.toLocaleString()} ABANDONED` : null,
    enriched?.isStale ? "STALE" : null,
  ].filter(Boolean);
  const vibe = getVibeStatus(latestScore);
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
            <p className="text-page text-foreground mb-4">Model not found</p>
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

  const trendDown = !enriched?.isLatestCarryForward && !enriched?.isStale && trend.direction === "down";
  const trendUp = !enriched?.isLatestCarryForward && !enriched?.isStale && trend.direction === "up";
  const trendCaption = enriched?.isStale
    ? "STALE SCORE"
    : enriched?.isLatestCarryForward
    ? "NO NEW POSTS"
    : trendUp
    ? `+${trend.pts} PTS FROM YESTERDAY`
    : trendDown
    ? `-${trend.pts} PTS FROM YESTERDAY`
    : "FLAT FROM YESTERDAY";

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          {/* Model Header */}
          <section className="container pt-10 pb-8 animate-fade-in">
            <Link
              to="/dashboard"
              className="mb-5 inline-flex items-center gap-1.5 rounded-md text-meta text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            <p className={`text-mono-cap text-text-tertiary`}>{vibe.label}</p>
            <div className="mt-1 flex items-center gap-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
              <h1 className="text-page text-foreground">{model.name}</h1>
            </div>
            <div className="mt-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-5">
              <p
                className="text-score sm:text-score-xl"
                style={{ color: vibe.color, textShadow: `0 0 30px ${vibe.color}40, 0 0 60px ${vibe.color}15` }}
              >
                {latestScore}
              </p>
              <p className={`pb-2 text-mono-cap text-text-secondary`}>{trendCaption}</p>
            </div>
            <p className="mt-3 text-mono-cap text-text-tertiary">
              {metaParts.join(" · ")}
            </p>
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
                    size="compact"
                    motion="fade"
                    className="flex items-center gap-4 sm:gap-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-mono-cap text-text-tertiary">
                        Recent incident analysis
                      </p>
                      <p className="mt-1 text-section text-foreground sm:truncate">
                        {featured.title}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
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
                    <p className="py-8 text-center text-body text-text-tertiary" role="status" aria-live="polite">
                      Failed to load data
                    </p>
                  ) : historyLoading ? (
                    <ChartSkeleton />
                  ) : (
                    <>
                      <SectionHeader title="Vibes over time" />
                      <div className="h-64">
                        <Suspense fallback={<div className="h-64 animate-pulse rounded bg-secondary/40" />}>
                          <LazyVibesChart chartData={chartData} accent={accent} timeRange={timeRange} events={chartEvents} />
                        </Suspense>
                      </div>
                      <div className="mt-4 flex gap-2" role="group" aria-label="Chart time range">
                        {TIME_RANGES.map((r) => (
                          <FilterChip
                            key={r}
                            pressed={timeRange === r}
                            onClick={() => setTimeRange(r)}
                          >
                            {r}
                          </FilterChip>
                        ))}
                      </div>
                      {chartEvents.length > 0 && (
                        <div className="mt-4 border-t border-border/40 pt-3">
                          <p className="mb-2 text-meta text-text-tertiary">Known events on this chart</p>
                          <ul className="space-y-1">
                            {chartEvents.map((evt, i) => (
                              <li key={`legend-${i}`} className="flex items-center gap-2 text-meta">
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
                    <SectionHeader title="Negative posts by surface" />
                    <BarList
                      ramp
                      max={100}
                      accent={accent}
                      items={negativeSurfaceRows.map((row) => ({ label: row.label, value: row.pct }))}
                    />
                  </Surface>
                )}

                <Surface motion="fade">
                  <SectionHeader title="Complaint breakdown" meta="Last 30 days" />
                  {complaintsError ? (
                    <p className="text-body text-text-tertiary" role="status" aria-live="polite">Failed to load data</p>
                  ) : complaintsLoading ? (
                    <BarsSkeleton count={5} />
                  ) : complaints && complaints.length > 0 ? (
                    <BarList
                      max={100}
                      accent={accent}
                      items={complaints.map((c) => ({ label: formatComplaintLabel(c.category), value: c.pct }))}
                    />
                  ) : (
                    <p className="text-body text-text-tertiary">No complaint data yet</p>
                  )}
                </Surface>

                <Surface motion="fade">
                  <SectionHeader title="Sources" meta="Share of posts over the last 30 days" />
                  {sourcesError ? (
                    <p className="text-body text-text-tertiary" role="status" aria-live="polite">Failed to load data</p>
                  ) : sourcesLoading ? (
                    <BarsSkeleton count={3} />
                  ) : sources && sources.filter((s) => s.pct > 0).length > 0 ? (
                    <BarList
                      max={100}
                      accent={accent}
                      items={sources.filter((s) => s.pct > 0).map((s) => ({ label: SOURCE_LABELS[s.source] || s.source, value: s.pct }))}
                    />
                  ) : (
                    <p className="text-body text-text-tertiary">No source data yet</p>
                  )}
                </Surface>
              </div>
            </div>
          </section>

          {/* Recent Posts */}
          <section className="container pb-12">
            <SectionHeader
              level="page"
              title={`Recent posts about ${model.name}`}
              className="mb-3"
            />
            {availableSurfaceLabels.length > 0 && (
              <div
                className="mb-6 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
                role="group"
                aria-label="Filter recent posts by product surface"
              >
                <FilterChip
                  pressed={surfaceFilter === "all"}
                  onClick={() => setSurfaceFilter("all")}
                >
                  All ({postsWithSurface.length})
                </FilterChip>
                {availableSurfaceLabels.map((label) => (
                  <FilterChip
                    key={label}
                    pressed={surfaceFilter === label}
                    onClick={() => setSurfaceFilter(label)}
                  >
                    {label} ({surfaceCounts.get(label) ?? 0})
                  </FilterChip>
                ))}
              </div>
            )}

            {postsError ? (
              <p className="py-8 text-center text-body text-text-tertiary" role="status" aria-live="polite">
                Failed to load data
              </p>
            ) : postsLoading ? (
              <div className="space-y-3" role="status" aria-live="polite">
                {Array.from({ length: 5 }).map((_, i) => <ChatterSkeleton key={i} />)}
              </div>
            ) : filteredPostsWithSurface.length === 0 && surfaceFilter !== "all" ? (
              <p className="py-8 text-center text-body text-text-tertiary">
                No recent posts match the {surfaceFilter} filter. Try another surface.
              </p>
            ) : filteredPostsWithSurface.length === 0 ? (
              <p className="py-8 text-center text-body text-text-tertiary">
                No posts in the last 7 days.
              </p>
            ) : (
              <div className="space-y-3">
                {filteredPostsWithSurface.map(({ post, surface }) => (
                  <ChatterPost
                    key={post.id}
                    post={post}
                    extraMeta={surface?.label ?? null}
                    hideModel
                  />
                ))}
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
