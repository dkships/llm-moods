import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import SectionHeader from "@/components/SectionHeader";
import ModelCard from "@/components/ModelCard";
import ChatterPost from "@/components/ChatterPost";
import useHead from "@/hooks/useHead";
import Footer from "@/components/Footer";
import {
  useModelsWithLatestVibes,
  useRecentChatter,
  usePrefetchModelDetail,
} from "@/hooks/useVibesData";
import StalenessBanner from "@/components/StalenessBanner";
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
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 className="text-page text-foreground">Current vibes</h1>
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
                {(models || []).map((m) => (
                  <ModelCard key={m.id} m={m} showSparkline onHover={handleHover} />
                ))}
              </div>
            )}
            <p className="mt-3 text-mono-cap text-text-tertiary">
              Scores are 0–100 · higher means happier users
            </p>
          </section>

          {/* Trending Complaints */}
          <section className="container pb-12">
            <TrendingComplaints />
          </section>

          {/* Community Chatter — lazy loaded on scroll */}
          <section className="container pb-12" ref={chatterRef}>
            <SectionHeader
              level="page"
              title="Recent community chatter"
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
                {(chatterData?.pages ?? []).flatMap((page) => page).map((post) => (
                  <ChatterPost key={post.id} post={post} />
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
