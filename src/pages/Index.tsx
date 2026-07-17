import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import ModelCard from "@/components/ModelCard";
import SectionHeader from "@/components/SectionHeader";
import Surface from "@/components/Surface";
import useHead from "@/hooks/useHead";
import { useModelsWithLatestVibes, usePrefetchModelDetail } from "@/hooks/useVibesData";
import { formatTimeAgo } from "@/lib/vibes";
import { CardSkeleton } from "@/components/Skeletons";

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

  // Oldest ingest across models — same honesty rule as the dashboard header: a
  // stalled scraper must not be masked by the healthiest model.
  const oldestModelIngestAt = (models || []).reduce<string | null>((oldest, model) => {
    if (!model.lastUpdated) return oldest;
    if (!oldest) return model.lastUpdated;
    return new Date(model.lastUpdated).getTime() < new Date(oldest).getTime() ? model.lastUpdated : oldest;
  }, null);

  return (
    <>
      {/* Hero */}
      <section className="container relative overflow-hidden pb-12 pt-16 sm:pb-16 sm:pt-20 lg:pt-24">
        <div className="pointer-events-none absolute -right-[18%] -top-40 h-[620px] w-[620px] rounded-full bg-[radial-gradient(ellipse_at_center,_hsl(var(--glow)/0.14)_0%,_hsl(var(--glow)/0.04)_36%,_transparent_68%)] sm:-right-[12%]" aria-hidden="true" />
        <div className="pointer-events-none absolute -left-[24%] top-40 h-[420px] w-[420px] rounded-full bg-[radial-gradient(ellipse_at_center,_hsl(var(--glow)/0.06)_0%,_transparent_70%)] sm:-left-[8%]" aria-hidden="true" />
        <div className="relative flex flex-col items-center text-center">
          <h1 className="text-hero text-foreground">
            Is your AI having<br />
            a <span className="text-primary glow-text">bad day</span>?
          </h1>
          <p className="mt-6 max-w-xl text-body text-text-secondary">
            A daily read on how the community feels about each model.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Button asChild size="lg" variant="outline" className="group gap-2 border-primary/40 font-mono text-sm text-foreground transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-foreground">
              <Link to="/dashboard">
                Check the Vibes
                <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
          </div>
          <p className="mt-8 text-mono-cap text-text-tertiary">
            Independent · 100% automated · open source
          </p>
        </div>
      </section>

      {/* Live Vibes Preview */}
      <section className="border-y border-border/80 bg-card/20">
        <div className="container py-10 sm:py-12">
            <div className="mb-5 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <h2 className="text-section text-foreground">Live model scores</h2>
              <span className="text-mono-cap text-text-tertiary">
                {oldestModelIngestAt
                  ? `Updated ${formatTimeAgo(oldestModelIngestAt)}`
                  : "Updated throughout the day"}
              </span>
            </div>
            {isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-live="polite">
                {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : isError ? (
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
        </div>
      </section>

      {/* How it works */}
      <section>
            <div className="container py-12 sm:py-16">
              <SectionHeader title="How it works" className="mb-6 sm:mb-8" />
              <ol className="grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-3">
                {[
                  {
                    title: "Scrape",
                    body: "Reddit, Hacker News, Bluesky, X/Twitter, and Mastodon checked throughout the day, plus App Store reviews.",
                  },
                  {
                    title: "Classify",
                    body: "Each post sentiment-labeled by Claude Haiku 4.5 into 12 complaint categories.",
                  },
                  {
                    title: "Score",
                    body: "Volume-weighted into a 0–100 daily score per model. Higher means happier users.",
                  },
                ].map((step, i) => (
                  <li key={step.title} className="border-t border-border pt-5 text-left">
                    <div className="flex items-baseline gap-3">
                      <span className="text-mono-cap text-text-tertiary">0{i + 1}</span>
                      <p className="text-section text-foreground">{step.title}</p>
                    </div>
                    <p className="mt-2.5 text-body text-text-secondary">
                      {step.body}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="mt-8 text-meta text-text-tertiary">
                <Link
                  to="/research/how-llm-vibes-classifies-sentiment"
                  className="inline-flex min-h-11 items-center gap-1 rounded-md text-text-secondary underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Read the full methodology
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </p>
            </div>
      </section>
    </>
  );
};

export default Index;
