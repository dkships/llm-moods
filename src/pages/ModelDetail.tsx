import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, lazy, Suspense } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import NotFound from "@/pages/NotFound";
import Surface from "@/components/Surface";
import SectionHeader from "@/components/SectionHeader";
import FilterChip from "@/components/FilterChip";
import ChatterPost from "@/components/ChatterPost";
import useHead from "@/hooks/useHead";
import {
  useModelDetail, useVibesHistory, useComplaintBreakdown,
  useSourceBreakdown, useModelPosts, useModelsWithLatestVibes,
  usePrefetchModelDetail,
} from "@/hooks/useVibesData";
import { getResearchPostsForModel } from "@/data/research-posts";
import { detectProductSurface } from "@/lib/product-surface";
import StatusCard from "@/components/StatusCard";
import BarList from "@/components/BarList";
import Tag from "@/components/Tag";
import { useDailyChartData, useChartEvents } from "@/lib/use-chart-data";
import {
  getVibeStatus, formatComplaintLabel, SOURCE_LABELS, sentimentAlpha,
} from "@/lib/vibes";
import { ChartSkeleton, BarsSkeleton, ChatterSkeleton, Shimmer } from "@/components/Skeletons";


const LazyVibesChart = lazy(() => import("@/components/VibesChart"));

const TIME_RANGES = ["24h", "7d", "30d"] as const;

const ModelDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const [timeRange, setTimeRange] = useState<typeof TIME_RANGES[number]>("30d");
  const [surfaceFilter, setSurfaceFilter] = useState<string>("all");

  const { data: fetchedModel, isLoading: modelLoading, isError: modelError } = useModelDetail(slug);
  const { data: allModels, isLoading: landingLoading, isError: landingError } = useModelsWithLatestVibes();
  const enriched = allModels?.find((m) => m.slug === slug);
  const prefetch = usePrefetchModelDetail();
  const siblingModels = (allModels ?? []).filter((m) => m.slug !== slug);

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
  ];
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
    const key = surface?.label ?? "Unspecified";
    negativeBySurface.set(key, (negativeBySurface.get(key) ?? 0) + 1);
  }
  const negativeSurfaceRows = Array.from(negativeBySurface.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label,
      pct: totalNegativePosts > 0 ? Math.round((count / totalNegativePosts) * 100) : 0,
    }));

  // Only surface this panel when there is a real product-surface signal — a
  // lone "Unknown 100%" bar carries no information (asymmetric-caveat pattern).
  const hasMeaningfulSurfaceRows = negativeSurfaceRows.some((r) => r.label !== "Unspecified");

  useHead({
    title: model ? `${model.name} Vibes — LLM Vibes` : "Loading — LLM Vibes",
    // Must stay byte-identical to the models block in scripts/prerender-routes.ts.
    description: model
      ? `Daily 0-100 community sentiment score for ${model.name}: trend history, complaint breakdown, and incident timeline from Reddit, Hacker News, X, Bluesky, and Mastodon.`
      : undefined,
    url: slug ? `/model/${slug}` : undefined,
    // Belt-and-braces for bad slugs: the nested <NotFound/> usually carries
    // this, but only because its child effect happens to run last.
    noindex: !modelLoading && !model,
    jsonLd: model && slug
      ? {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://llmvibes.ai/" },
            { "@type": "ListItem", position: 2, name: "Dashboard", item: "https://llmvibes.ai/dashboard" },
            { "@type": "ListItem", position: 3, name: model.name, item: `https://llmvibes.ai/model/${slug}` },
          ],
        }
      : undefined,
  });

  // Daily chart hooks must run unconditionally (above any early-return) to
  // satisfy the rules of hooks. The values are unused on the loading/not-found
  // paths but the calls themselves still have to happen each render.
  const dailyChart = useDailyChartData(vibesHistory, timeRange === "7d" ? 7 : 30);
  const dailyEvents = useChartEvents(slug ?? "", dailyChart.dateLabels);

  if ((!model && (modelLoading || landingLoading)) || (model && !enriched && landingLoading)) {
    return (
            <section className="container min-h-[calc(100svh-3.5rem)] pb-8 pt-10 sm:min-h-[calc(100svh-4rem)] sm:pt-12">
              <div className="space-y-4" role="status" aria-live="polite">
                <span className="sr-only">Loading model data</span>
                <Shimmer className="h-4 w-32" />
                <Shimmer className="h-10 w-48" />
                <Shimmer className="h-16 w-32" />
              </div>
            </section>
    );
  }

  if (!model && modelError) {
    return (
          <section className="container flex min-h-[calc(100svh-14rem)] items-center justify-center py-16">
            <div className="text-center">
              <h1 className="mb-4 text-page text-foreground">Couldn't load model data</h1>
              <p className="text-body text-text-secondary mb-8">Check your connection and reload the page.</p>
              <Button asChild variant="outline" className="min-h-11 text-meta">
                <Link to="/dashboard">Back to Dashboard</Link>
              </Button>
            </div>
          </section>
    );
  }

  if (!model) {
    return <NotFound />;
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
      return {
        day: label,
        score: v.score,
        eligiblePosts: v.eligible_posts ?? null,
        scoreBasisStatus: v.score_basis_status ?? null,
        queuedPosts: v.queued_posts ?? null,
      };
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
    <>
          {/* Model Header */}
          <section className="container pb-8 pt-10 sm:pt-12">
            <Link
              to="/dashboard"
              className="mb-5 inline-flex min-h-11 items-center gap-1.5 rounded-md text-meta text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            {enriched && <p className={`text-mono-cap text-text-tertiary`}>{vibe.label}</p>}
            <div className="mt-1 flex items-center gap-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
              <h1 className="text-page text-foreground">{model.name}</h1>
            </div>
            {enriched ? (
              <>
                <div className="mt-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-5">
                  <p
                    className="text-score sm:text-score-xl"
                    style={{ color: vibe.color, textShadow: `0 0 30px ${sentimentAlpha(vibe.color, 0.25)}, 0 0 60px ${sentimentAlpha(vibe.color, 0.08)}` }}
                  >
                    {latestScore}
                  </p>
                  <p className={`pb-2 text-mono-cap text-text-secondary`}>{trendCaption}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-mono-cap text-text-tertiary">
                  <span>{metaParts.join(" · ")}</span>
                  {enriched?.isStale && (
                    <Tag tone="warning" shape="pill" title="Score not refreshed with new posts recently">
                      Stale
                    </Tag>
                  )}
                  {enriched?.scoreBasisStatus === "thin_sample" && (
                    <Tag tone="warning" shape="pill" title="Today's score rests on a small number of high-confidence posts">
                      Low sample
                    </Tag>
                  )}
                  {failedPosts > 0 && (
                    <Tag tone="warning" shape="pill" title="Posts that couldn't be classified after several attempts">
                      {failedPosts.toLocaleString()} abandoned
                    </Tag>
                  )}
                </div>
              </>
            ) : landingError ? (
              <p className="mt-4 text-body text-text-secondary">Live score unavailable right now.</p>
            ) : (
              <div className="mt-4 space-y-3" role="status" aria-live="polite">
                <Shimmer className="h-14 w-32" />
                <Shimmer className="h-4 w-52" />
              </div>
            )}
            {siblingModels.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 text-meta text-text-tertiary">
                <span>Also tracking:</span>
                {siblingModels.map((m, i) => (
                  <span key={m.slug} className="inline-flex items-center gap-3">
                    <Link
                      to={`/model/${m.slug}`}
                      onMouseEnter={() => prefetch(m.slug, m.id)}
                      className="inline-flex min-h-11 items-center rounded-md text-text-secondary underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {m.name}
                    </Link>
                    {i < siblingModels.length - 1 && <span aria-hidden="true">·</span>}
                  </span>
                ))}
              </div>
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
                >
                  <Surface
                    as="article"
                    size="compact"
                    elevation="lift"
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
            {/* md step added: this jumped straight from one column to three, so
                768-1023px tablets stacked chart, status, complaints and sources
                into a single full-width column and stretched the fixed h-64
                chart into a very wide, very short strip. */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {/* Left Column — Chart + Official Status stacked */}
              <div className="space-y-6 md:col-span-2">
                <Surface>
                  {historyError ? (
                    <p className="py-8 text-center text-body text-text-tertiary" role="status" aria-live="polite">
                      Couldn't load the chart.
                    </p>
                  ) : historyLoading ? (
                    <div role="status" aria-live="polite">
                      <span className="sr-only">Loading sentiment history</span>
                      <ChartSkeleton />
                    </div>
                  ) : chartData.every((d) => d.score == null) ? (
                    // A window that predates collection for this model resolves
                    // successfully with an all-null grid; without this branch the
                    // panel renders a bare axis box that reads as broken.
                    // EmbeddedModelChart already guards the same case.
                    <>
                      <SectionHeader title="Vibes over time" />
                      <p className="py-8 text-center text-body text-text-tertiary">
                        No score data for this window.
                      </p>
                      <div className="mt-4 flex gap-2" role="group" aria-label="Chart time range">
                        {TIME_RANGES.map((r) => (
                          <FilterChip key={r} pressed={timeRange === r} onClick={() => setTimeRange(r)}>
                            {r}
                          </FilterChip>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <SectionHeader title="Vibes over time" />
                      <div className="h-64">
                        <ErrorBoundary
                          fallback={
                            <p className="py-8 text-center text-body text-text-tertiary" role="status" aria-live="polite">
                              Couldn't render the chart.
                            </p>
                          }
                        >
                          <Suspense fallback={<div className="h-64 animate-pulse rounded bg-secondary/40" />}>
                            <LazyVibesChart chartData={chartData} accent={accent} timeRange={timeRange} events={chartEvents} />
                          </Suspense>
                        </ErrorBoundary>
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
                        <div className="mt-4 border-t border-border pt-3">
                          <p className="mb-2 text-meta text-text-tertiary">Known events on this chart</p>
                          <ul className="space-y-2">
                            {chartEvents.map((evt, i) => (
                              <li key={`legend-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
                                <span
                                  className={
                                    evt.endLabel
                                      ? "inline-block h-2 w-3 shrink-0 rounded-sm"
                                      : "inline-block h-3 w-1 shrink-0 rounded-sm"
                                  }
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
                {hasMeaningfulSurfaceRows && (
                  <Surface>
                    <SectionHeader title="Negative posts by surface" />
                    <BarList
                      ramp
                      max={100}
                      accent={accent}
                      items={negativeSurfaceRows.map((row) => ({ label: row.label, value: row.pct }))}
                    />
                  </Surface>
                )}

                <Surface>
                  <SectionHeader title="Complaint breakdown" meta="Last 30 days" />
                  {complaintsError ? (
                    <p className="text-body text-text-tertiary" role="status" aria-live="polite">Couldn't load complaints.</p>
                  ) : complaintsLoading ? (
                    <div role="status" aria-live="polite">
                      <span className="sr-only">Loading complaint breakdown</span>
                      <BarsSkeleton count={5} />
                    </div>
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

                <Surface>
                  <SectionHeader title="Sources" meta="Share of posts over the last 30 days" />
                  {sourcesError ? (
                    <p className="text-body text-text-tertiary" role="status" aria-live="polite">Couldn't load sources.</p>
                  ) : sourcesLoading ? (
                    <div role="status" aria-live="polite">
                      <span className="sr-only">Loading source breakdown</span>
                      <BarsSkeleton count={3} />
                    </div>
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
              <div className="relative mb-6 -mx-4 sm:mx-0">
                <div
                  className="flex gap-2 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
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
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent sm:hidden"
                  aria-hidden="true"
                />
              </div>
            )}

            {postsError ? (
              <p className="py-8 text-center text-body text-text-tertiary" role="status" aria-live="polite">
                Couldn't load posts.
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
    </>
  );
};

export default ModelDetail;
