import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import ModelCard from "@/components/ModelCard";
import SectionHeader from "@/components/SectionHeader";
import useHead from "@/hooks/useHead";
import Footer from "@/components/Footer";
import { useModelsWithLatestVibes, usePrefetchModelDetail } from "@/hooks/useVibesData";
import { CardSkeleton } from "@/components/Skeletons";

const PLATFORM_COUNT = 5;

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
          <section className="container pt-14 sm:pt-24 pb-12 relative overflow-hidden">
            <div className="absolute -top-32 right-[-12%] w-[620px] h-[620px] rounded-full bg-[radial-gradient(ellipse_at_center,_hsl(var(--glow)/0.14)_0%,_transparent_62%)] blur-[2px] pointer-events-none" aria-hidden="true" />
            <div className="absolute top-40 left-[-8%] w-[360px] h-[360px] rounded-full bg-[radial-gradient(ellipse_at_center,_hsl(var(--glow)/0.06)_0%,_transparent_70%)] pointer-events-none" aria-hidden="true" />
            <div className="max-w-3xl relative animate-fade-in">
              <h1 className="text-hero text-foreground">
                Is your AI having<br />
                a <span className="text-primary glow-text">bad day</span>?
              </h1>
              <p className="mt-6 text-body text-text-secondary max-w-xl">
                A daily read on community sentiment, before the AI Twitter discourse catches up.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Button asChild size="lg" variant="outline" className="font-mono text-sm gap-2 group border-primary/40 text-foreground transition-all hover:bg-primary/10 hover:text-foreground hover:border-primary/60">
                  <Link to="/dashboard">
                    Check the Vibes
                    <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-1" />
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
                {(models || []).map((m) => (
                  <ModelCard key={m.id} m={m} showSparkline onHover={handleHover} />
                ))}
              </div>
            )}
          </section>

          {/* How it works */}
          <section className="border-t border-border">
            <div className="container py-12 sm:py-16">
              <SectionHeader title="How it works" className="mb-8 sm:mb-10" />
              <ol className="grid grid-cols-1 gap-8 sm:gap-10 md:grid-cols-3">
                {[
                  {
                    title: "Scrape",
                    body: `${PLATFORM_COUNT} social platforms checked throughout the day — Reddit, Hacker News, Bluesky, X/Twitter, Mastodon.`,
                  },
                  {
                    title: "Classify",
                    body: "Each post sentiment-labeled by Claude Haiku 4.5 into 12 complaint categories.",
                  },
                  {
                    title: "Score",
                    body: "Volume-weighted into a 0–100 daily vibe per model. Higher means happier users.",
                  },
                ].map((step, i) => (
                  <li key={step.title} className="text-left">
                    <p className="text-mono-cap text-text-tertiary">
                      0{i + 1}
                    </p>
                    <p className="mt-2 text-section text-foreground">
                      {step.title}
                    </p>
                    <p className="mt-2 text-body text-text-secondary">
                      {step.body}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </PageTransition>
  );
};

export default Index;
