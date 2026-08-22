import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import Surface from "@/components/Surface";
import SectionHeader from "@/components/SectionHeader";
import PageHeader from "@/components/PageHeader";
import FilterChip from "@/components/FilterChip";
import ModelCard from "@/components/ModelCard";
import ChatterPost from "@/components/ChatterPost";
import BarList from "@/components/BarList";
import useHead from "@/hooks/useHead";
import {
  useModelsWithLatestVibes, useVibesHistory, useComplaintBreakdown, useModelPosts,
} from "@/hooks/useVibesData";
import type { ModelWithVibes } from "@/hooks/useVibesData";
import { useDailyChartData } from "@/lib/use-chart-data";
import { formatComplaintLabel } from "@/lib/vibes";
import { normalizeSentiment } from "@/shared/public-taxonomy";
import { ChartSkeleton, BarsSkeleton, ChatterSkeleton, CardSkeleton } from "@/components/Skeletons";

const LazyVibesChart = lazy(() => import("@/components/VibesChart"));

const CHART_DAYS = 30;
const RECENT_POSTS_LIMIT = 3;

function ChartCell({ model }: { model: ModelWithVibes }) {
  const accent = model.accent_color || "#888";
  const { data: history, isLoading, isError } = useVibesHistory(model.id, "daily", "30d");
  const { chartData } = useDailyChartData(history, CHART_DAYS);

  return (
    <Surface>
      <SectionHeader title="30-day trend" />
      {isError ? (
        <p className="py-6 text-center text-body text-text-tertiary" role="status" aria-live="polite">
          Couldn't load the chart.
        </p>
      ) : isLoading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading {model.name} sentiment history</span>
          <ChartSkeleton />
        </div>
      ) : chartData.every((d) => d.score == null) ? (
        <p className="py-6 text-center text-body text-text-tertiary">
          No score data for this window.
        </p>
      ) : (
        <div className="h-40 sm:h-48">
          <ErrorBoundary
            fallback={
              <p className="py-6 text-center text-body text-text-tertiary" role="status" aria-live="polite">
                Couldn't render the chart.
              </p>
            }
          >
            <Suspense fallback={<div className="h-full animate-pulse rounded bg-secondary/40" />}>
              <LazyVibesChart chartData={chartData} accent={accent} timeRange="30d" />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
    </Surface>
  );
}

function ComplaintsCell({ model }: { model: ModelWithVibes }) {
  const accent = model.accent_color || "#888";
  const { data: complaints, isLoading, isError } = useComplaintBreakdown(model.id);
  const top3 = (complaints ?? []).slice(0, 3);

  return (
    <Surface>
      <SectionHeader title="Top complaints" meta="Last 30 days" />
      {isError ? (
        <p className="text-body text-text-tertiary" role="status" aria-live="polite">Couldn't load complaints.</p>
      ) : isLoading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading {model.name} complaint breakdown</span>
          <BarsSkeleton count={3} />
        </div>
      ) : top3.length > 0 ? (
        <BarList
          max={100}
          accent={accent}
          items={top3.map((c) => ({ label: formatComplaintLabel(c.category), value: c.pct }))}
        />
      ) : (
        <p className="text-body text-text-tertiary">No complaint data yet</p>
      )}
    </Surface>
  );
}

// There is no public breakdown of praise categories (praise_category never
// leaves the backend — no get_praise_breakdown RPC, and get_public_model_posts
// / get_public_recent_chatter don't select it; see AGENTS.md Definition of
// Done: anon reads only go through get_public_* RPCs, so it can't be read
// around). `sentiment` on the recent-posts RPC is the closest real public
// signal, so this renders the positive/neutral/negative mix over the same
// last-7-days window as the Recent posts panel below instead of fabricating
// a category list.
function SentimentMixCell({ model }: { model: ModelWithVibes }) {
  const accent = model.accent_color || "#888";
  const { data: posts, isLoading, isError } = useModelPosts(model.id, 25);

  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const post of posts ?? []) {
    const sentiment = normalizeSentiment(post.sentiment);
    if (sentiment) counts[sentiment] += 1;
  }
  const total = counts.positive + counts.neutral + counts.negative;
  const rows = [
    { label: "Positive", count: counts.positive },
    { label: "Neutral", count: counts.neutral },
    { label: "Negative", count: counts.negative },
  ];

  return (
    <Surface>
      <SectionHeader title="Sentiment mix" meta="Last 7 days" />
      {isError ? (
        <p className="text-body text-text-tertiary" role="status" aria-live="polite">Couldn't load recent posts.</p>
      ) : isLoading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading {model.name} sentiment mix</span>
          <BarsSkeleton count={3} />
        </div>
      ) : total > 0 ? (
        <BarList
          max={100}
          accent={accent}
          items={rows.map((r) => ({
            label: r.label,
            value: total > 0 ? Math.round((r.count / total) * 100) : 0,
          }))}
        />
      ) : (
        <p className="text-body text-text-tertiary">No posts in the last 7 days</p>
      )}
    </Surface>
  );
}

function RecentPostsCell({ model }: { model: ModelWithVibes }) {
  const { data: posts, isLoading, isError } = useModelPosts(model.id, 25);
  const recent = (posts ?? []).slice(0, RECENT_POSTS_LIMIT);

  return (
    <div>
      <SectionHeader title="Recent posts" />
      {isError ? (
        <p className="py-4 text-center text-body text-text-tertiary" role="status" aria-live="polite">
          Couldn't load posts.
        </p>
      ) : isLoading ? (
        <div className="space-y-3" role="status" aria-live="polite">
          <span className="sr-only">Loading {model.name} recent posts</span>
          {Array.from({ length: RECENT_POSTS_LIMIT }).map((_, i) => <ChatterSkeleton key={i} />)}
        </div>
      ) : recent.length > 0 ? (
        <div className="space-y-3">
          {recent.map((post) => (
            <ChatterPost key={post.id} post={post} hideModel />
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-body text-text-tertiary">No posts in the last 7 days.</p>
      )}
    </div>
  );
}

const Compare = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: models, isLoading: modelsLoading, isError: modelsError } = useModelsWithLatestVibes();

  const sortedByScore = [...(models ?? [])].sort((a, b) => b.latestScore - a.latestScore);
  const aSlug = searchParams.get("a");
  const bSlug = searchParams.get("b");

  const modelA = (aSlug && (models ?? []).find((m) => m.slug === aSlug)) || sortedByScore[0];
  let modelB = (bSlug && (models ?? []).find((m) => m.slug === bSlug)) || sortedByScore[1];
  if (modelA && modelB && modelB.slug === modelA.slug) {
    modelB = sortedByScore.find((m) => m.slug !== modelA.slug) ?? modelB;
  }

  const title = modelA && modelB
    ? `Compare ${modelA.name} vs ${modelB.name} — LLM Vibes`
    : "Compare AI models — LLM Vibes";

  useHead({
    title,
    description: "Put two tracked AI models side by side: score, 30-day trend, complaints, sentiment mix, and recent chatter, compared like with like.",
    url: "/compare",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://llmvibes.ai/" },
        { "@type": "ListItem", position: 2, name: "Compare", item: "https://llmvibes.ai/compare" },
      ],
    },
  });

  const selectModel = (slot: "a" | "b", slug: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(slot, slug);
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <section className="container pb-8 pt-10 sm:pt-12">
        <PageHeader
          title="Compare AI models"
          description="Pick any two tracked models to see how their community sentiment, trend, and complaints stack up side by side."
        />
      </section>

      <section className="container pb-8">
        {modelsLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" role="status" aria-live="polite">
            <span className="sr-only">Loading models</span>
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : modelsError ? (
          <Surface className="text-center" role="status" aria-live="polite">
            <p className="text-section text-foreground">Model scores are unavailable</p>
            <p className="mt-2 text-body text-text-tertiary">Refresh the page to try again.</p>
          </Surface>
        ) : !modelA || !modelB ? (
          <Surface className="text-center">
            <p className="text-body text-text-tertiary">Need at least two tracked models to compare.</p>
          </Surface>
        ) : (
          <>
            <div className="space-y-3">
              <div role="group" aria-label="Left model" className="flex flex-wrap gap-2">
                {(models ?? []).map((m) => (
                  <FilterChip
                    key={`a-${m.slug}`}
                    pressed={m.slug === modelA.slug}
                    disabled={m.slug === modelB.slug}
                    className={m.slug === modelB.slug ? "opacity-40" : ""}
                    onClick={() => selectModel("a", m.slug)}
                  >
                    {m.name}
                  </FilterChip>
                ))}
              </div>
              <div role="group" aria-label="Right model" className="flex flex-wrap gap-2">
                {(models ?? []).map((m) => (
                  <FilterChip
                    key={`b-${m.slug}`}
                    pressed={m.slug === modelB.slug}
                    disabled={m.slug === modelA.slug}
                    className={m.slug === modelA.slug ? "opacity-40" : ""}
                    onClick={() => selectModel("b", m.slug)}
                  >
                    {m.name}
                  </FilterChip>
                ))}
              </div>
            </div>

            {/* One grid with shared row tracks (not two independent column
                stacks): cells are emitted in A, B pairs per row (header,
                header / chart, chart / …) so each row track's height is
                driven by the taller of the two sides and "Claude's chart"
                always lines up with "ChatGPT's chart". On mobile the grid
                drops to one column but keeps the same interleaved order, so
                adjacent sections stay comparable while scrolling instead of
                requiring a scroll back up to compare. */}
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-x-6 md:gap-y-6">
              <ModelCard m={modelA} />
              <ModelCard m={modelB} />

              <ChartCell model={modelA} />
              <ChartCell model={modelB} />

              <ComplaintsCell model={modelA} />
              <ComplaintsCell model={modelB} />

              <SentimentMixCell model={modelA} />
              <SentimentMixCell model={modelB} />

              <RecentPostsCell model={modelA} />
              <RecentPostsCell model={modelB} />
            </div>
          </>
        )}
      </section>
    </>
  );
};

export default Compare;
