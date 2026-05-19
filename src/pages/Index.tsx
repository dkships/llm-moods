import { ArrowRight, Radar, Brain, LineChart } from "lucide-react";
import { Link } from "react-router-dom";
import { memo, useCallback, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import Surface from "@/components/Surface";
import useHead from "@/hooks/useHead";
import Footer from "@/components/Footer";
import { useModelsWithLatestVibes, usePrefetchModelDetail, type ModelWithVibes } from "@/hooks/useVibesData";
import { getVibeStatus, formatComplaintLabel } from "@/lib/vibes";
import { CardSkeleton } from "@/components/Skeletons";

const PLATFORM_COUNT = 5;

const LandingModelCard = memo(forwardRef<HTMLAnchorElement, { m: ModelWithVibes; i: number; onHover: (slug: string, id: string) => void }>(
  ({ m, onHover }, ref) => {
    const vibe = getVibeStatus(m.latestScore);
    const brandColor = m.accent_color || "#888";
    const trendUp = m.trend.direction === "up" && !m.isLatestCarryForward && !m.isStale;
    const trendDown = m.trend.direction === "down" && !m.isLatestCarryForward && !m.isStale;
    const trendCaption = m.isStale
      ? "STALE SCORE"
      : m.isLatestCarryForward
      ? "NO NEW POSTS"
      : trendUp
      ? `+${m.trend.pts} PTS`
      : trendDown
      ? `-${m.trend.pts} PTS`
      : "0 PTS";
    const postsCaption = `${(m.totalPosts || 0).toLocaleString()} POSTS`;

    return (
      <Link
        ref={ref}
        to={`/model/${m.slug}`}
        onMouseEnter={() => onHover(m.slug, m.id)}
        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Surface size="bare" motion="fade" className="overflow-hidden h-full">
          <div className="h-1.5" style={{ background: vibe.color }} />
          <div className="p-6">
            <p className="text-mono-cap text-text-tertiary">{vibe.label}</p>
            <div className="mt-1 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: brandColor }} />
                <p className="truncate text-section text-foreground">{m.name}</p>
              </div>
              <p
                className="shrink-0 text-score"
                style={{ color: vibe.color }}
              >
                {m.latestScore}
              </p>
            </div>

            <p className="mt-3 text-mono-cap">
              <span className="text-text-secondary">{trendCaption}</span>
              <span className="text-text-tertiary"> · {postsCaption}</span>
            </p>

            {m.topComplaint && (
              <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
                <span className="text-mono-cap shrink-0 text-text-tertiary">Top</span>
                <span className="truncate text-body font-medium text-foreground">
                  {formatComplaintLabel(m.topComplaint)}
                </span>
              </div>
            )}
          </div>
        </Surface>
      </Link>
    );
  }
));
LandingModelCard.displayName = "LandingModelCard";

const Index = () => {
  useHead({
    title: "LLM Vibes — Is Your AI Having a Bad Day?",
    description: "Updated throughout the day, LLM Vibes tracks community sentiment for Claude, ChatGPT, Gemini, and Grok.",
    url: "/",
  });
  const { data: models, isLoading, isError } = useModelsWithLatestVibes();
  const prefetch = usePrefetchModelDetail();

  const handleHover = useCallback((slug: string, id: string) => {
    prefetch(slug, id);
  }, [prefetch]);

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          {/* Hero */}
          <section className="container pt-12 sm:pt-20 pb-10 relative overflow-hidden">
            <div className="absolute -top-24 right-[-10%] w-[520px] h-[520px] rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(16,185,129,0.12)_0%,_transparent_65%)] pointer-events-none" />
            <div className="max-w-3xl relative animate-fade-in">
              <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground leading-[1.1]">
                Is your AI having<br />
                a <span className="text-primary glow-text">bad day</span>?
              </h1>
              <p className="mt-5 text-lg sm:text-xl text-text-secondary max-w-xl leading-relaxed">
                Community sentiment for Claude, ChatGPT, Gemini, and Grok. Know when the vibes are off.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-4">
                <Button asChild size="lg" className="font-mono text-sm gap-2 group">
                  <Link to="/dashboard">
                    Check the Vibes
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </section>

          {/* Live Vibes Preview */}
          <section className="container pb-24">
            {isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-live="polite">
                {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : isError ? (
              <p className="py-8 text-center text-sm text-text-tertiary" role="status" aria-live="polite">
                Failed to load data
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
                {(models || []).map((m, i) => (
                  <LandingModelCard key={m.id} m={m} i={i} onHover={handleHover} />
                ))}
              </div>
            )}
          </section>

          {/* How it works */}
          <section className="border-y border-border bg-card/40">
            <div className="container py-12 sm:py-16">
              <div className="grid grid-cols-1 gap-8 sm:gap-10 md:grid-cols-3 animate-fade-in">
                {[
                  {
                    Icon: Radar,
                    title: "Scrape",
                    body: `${PLATFORM_COUNT} social platforms checked throughout the day — Reddit, Hacker News, Bluesky, X/Twitter, Mastodon.`,
                  },
                  {
                    Icon: Brain,
                    title: "Classify",
                    body: "Each post sentiment-labeled by Gemini 2.5 Flash into 12 complaint categories.",
                  },
                  {
                    Icon: LineChart,
                    title: "Score",
                    body: "Volume-weighted into a 0–100 daily vibe per model. Higher means happier users.",
                  },
                ].map((step) => (
                  <div key={step.title} className="text-center sm:text-left">
                    <step.Icon className="h-7 w-7 text-primary mb-3 mx-auto sm:mx-0" aria-hidden="true" />
                    <p className="text-section text-foreground">{step.title}</p>
                    <p className="mt-2 text-body text-text-secondary">{step.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </PageTransition>
  );
};

export default Index;
