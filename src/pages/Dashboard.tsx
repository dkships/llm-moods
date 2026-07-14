import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import SectionHeader from "@/components/SectionHeader";
import Surface from "@/components/Surface";
import ModelCard from "@/components/ModelCard";
import ChatterPost from "@/components/ChatterPost";
import useHead from "@/hooks/useHead";
import {
  useModelsWithLatestVibes,
  useRecentChatter,
  usePrefetchModelDetail,
} from "@/hooks/useVibesData";
import { formatTimeAgo } from "@/lib/vibes";
import { DashboardCardSkeleton, ChatterSkeleton } from "@/components/Skeletons";
import TrendingComplaints from "@/components/TrendingComplaints";

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

  // Deliberately the OLDEST ingest time across models (commit 0d3e339): a
  // stalled scraper must keep the "Updated" label honest instead of being
  // masked by the healthiest model.
  const oldestModelIngestAt = (models || []).reduce<string | null>((oldest, model) => {
    if (!model.lastUpdated) return oldest;
    if (!oldest) return model.lastUpdated;
    return new Date(model.lastUpdated).getTime() < new Date(oldest).getTime() ? model.lastUpdated : oldest;
  }, null);

  // Dedupe multi-model fanout: the same scraped post is stored once per
  // matched model, so the feed otherwise shows the exact same text twice in a
  // row. Collapse to one row and collect the matched model names into the meta
  // line. Memoized: the infinite-scroll list grows and this runs over all of it.
  const dedupedChatter = useMemo(() => {
    const rows = (chatterData?.pages ?? []).flatMap((p) => p);
    const seen = new Map<string, { post: typeof rows[number]; models: string[] }>();
    for (const post of rows) {
      const key =
        post.source_url ||
        `${post.source}::${(post.translated_content || post.content || post.title || "").slice(0, 200)}`;
      const existing = seen.get(key);
      const modelName = post.models?.name ?? null;
      if (existing) {
        if (modelName && !existing.models.includes(modelName)) {
          existing.models.push(modelName);
        }
      } else {
        seen.set(key, {
          post,
          models: modelName ? [modelName] : [],
        });
      }
    }
    return Array.from(seen.values());
  }, [chatterData]);

  return (
    <>
          {/* Page Header */}
          <section className="container pb-8 pt-10 sm:pt-12">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 className="text-page text-foreground">Current vibes</h1>
              <p
                className="text-meta text-text-tertiary"
                role="status"
                aria-live="polite"
              >
                {oldestModelIngestAt
                  ? `Updated ${formatTimeAgo(oldestModelIngestAt)} · ${today}`
                  : today}
              </p>
            </div>
          </section>

          {/* Model Cards */}
          <section className="container pb-12">
            {modelsLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-live="polite">
                {Array.from({ length: 4 }).map((_, i) => <DashboardCardSkeleton key={i} />)}
              </div>
            ) : modelsError ? (
              <Surface className="text-center" role="status" aria-live="polite">
                <p className="text-section text-foreground">Model scores are unavailable</p>
                <p className="mt-2 text-body text-text-tertiary">Refresh the page to try again.</p>
              </Surface>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {(models || []).map((m) => (
                  <ModelCard key={m.id} m={m} showSparkline onHover={handleHover} />
                ))}
              </div>
            )}
            <p className="mt-3 text-mono-cap text-text-tertiary">
              Scores are 0–100 · higher means happier users ·{" "}
              <Link
                to="/research/how-llm-vibes-classifies-sentiment"
                className="rounded-md underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                How scoring works
              </Link>
            </p>
          </section>

          {/* Trending Complaints */}
          <section className="container pb-12">
            <TrendingComplaints />
          </section>

          {/* Community Chatter — lazy loaded on scroll */}
          <section className="container pb-12" ref={chatterRef}>
            <SectionHeader
              title="Recent community chatter"
            />

            {chatterError ? (
              <Surface className="text-center" role="status" aria-live="polite">
                <p className="text-section text-foreground">Community chatter is unavailable</p>
                <p className="mt-2 text-body text-text-tertiary">Refresh the page to try again.</p>
              </Surface>
            ) : !chatterVisible || chatterLoading ? (
              <div className="space-y-3" role="status" aria-live="polite">
                {Array.from({ length: 6 }).map((_, i) => <ChatterSkeleton key={i} />)}
              </div>
            ) : dedupedChatter.length === 0 ? (
              <Surface className="text-center">
                <p className="text-body text-text-tertiary">No posts in the last 7 days.</p>
              </Surface>
            ) : (
              <div className="space-y-3">
                {dedupedChatter.map(({ post, models }) => (
                  <ChatterPost
                    key={post.id}
                    post={{
                      ...post,
                      models: models.length > 0 ? { name: models.join(", ") } : post.models,
                    }}
                  />
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
                  className="min-h-11 font-mono text-xs"
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </section>
    </>
  );
};

export default Dashboard;
