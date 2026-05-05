import { TrendingUp, TrendingDown, Minus, ArrowRight, Radar, Brain, LineChart } from "lucide-react";
import { Link } from "react-router-dom";
import { memo, useCallback, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import Surface from "@/components/Surface";
import ScoreMetaBadge from "@/components/ScoreMetaBadge";
import useHead from "@/hooks/useHead";
import Footer from "@/components/Footer";
import { useModelsWithLatestVibes, usePrefetchModelDetail, type ModelWithVibes } from "@/hooks/useVibesData";
import { getVibeStatus } from "@/lib/vibes";
import { CardSkeleton } from "@/components/Skeletons";

const GitHubIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const PLATFORM_COUNT = 5;

const TrendIcon = forwardRef<SVGSVGElement, { trend: string }>(({ trend, ...props }, ref) => {
  if (trend === "up") return <TrendingUp ref={ref} className="h-4 w-4 text-primary" {...props} />;
  if (trend === "down") return <TrendingDown ref={ref} className="h-4 w-4 text-destructive" {...props} />;
  return <Minus ref={ref} className="h-4 w-4 text-text-tertiary" {...props} />;
});
TrendIcon.displayName = "TrendIcon";

const LandingModelCard = memo(forwardRef<HTMLAnchorElement, { m: ModelWithVibes; i: number; onHover: (slug: string, id: string) => void }>(
  ({ m, onHover }, ref) => {
    const vibe = getVibeStatus(m.latestScore);
    const VibeIcon = vibe.icon;
    const brandColor = m.accent_color || "#888";
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
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: brandColor }} />
                  <p className="font-display text-sm font-semibold text-foreground">{m.name}</p>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <VibeIcon className="h-5 w-5" style={{ color: vibe.color }} />
                  <span className="font-mono text-sm" style={{ color: vibe.color }}>{vibe.label}</span>
                </div>
              </div>
              <p className="text-3xl font-extrabold font-mono text-foreground leading-none">{m.latestScore}</p>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <TrendIcon trend={m.trend.direction} />
              <ScoreMetaBadge title="Classified posts from the last 7 days.">
                {m.totalPosts > 0 ? `${m.totalPosts.toLocaleString()} posts · 7d` : "Tracking"}
              </ScoreMetaBadge>
            </div>
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
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-mono text-primary">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Tracking {models?.length ?? "…"} models
              </div>
              <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground leading-[1.1]">
                Is your AI having<br />
                a <span className="text-primary glow-text">bad day</span>?
              </h1>
              <p className="mt-5 text-lg sm:text-xl text-text-secondary max-w-xl leading-relaxed">
                Community sentiment for Claude, ChatGPT, Gemini, and Grok. Know when the vibes are off.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Button asChild size="lg" className="font-mono text-sm gap-2 group">
                  <Link to="/dashboard">
                    Check the Vibes
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
                <a
                  href="https://github.com/dkships/llm-moods"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md text-sm font-mono text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <GitHubIcon className="h-4 w-4" />
                  Open Source
                </a>
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
                    <p className="font-display text-lg font-semibold text-foreground">{step.title}</p>
                    <p className="mt-2 text-sm text-text-secondary leading-relaxed">{step.body}</p>
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
