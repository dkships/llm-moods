import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import PageHeader from "@/components/PageHeader";
import Surface from "@/components/Surface";
import RumorCard from "@/components/rumors/RumorCard";
import useHead from "@/hooks/useHead";
import { useRumors } from "@/hooks/useRumors";

const Rumors = () => {
  const { data: rumors, isLoading } = useRumors();

  useHead({
    title: "Rumors — LLM Vibes",
    description:
      "Aggregated community chatter about unreleased AI models — what's being discussed, when it's expected, and the signals behind it. Unconfirmed estimates, not forecasts.",
    url: "/rumors",
  });

  // Strongest corroboration first; recency breaks ties.
  const sorted = [...(rumors ?? [])].sort(
    (a, b) =>
      b.platform_count - a.platform_count ||
      b.mention_count - a.mention_count ||
      (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? ""),
  );

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          <section className="container pt-10 pb-8 animate-fade-in">
            <PageHeader
              title="Rumors"
              description="What the community is saying about unreleased Claude, ChatGPT, Gemini, and Grok models — the next version, its stage, and when it's rumored to land."
            />
          </section>

          <section className="container pb-12">
            {isLoading ? (
              <p className="text-body text-text-tertiary">Loading…</p>
            ) : sorted.length === 0 ? (
              <Surface motion="fade">
                <p className="text-body text-text-secondary">No strong rumors right now.</p>
                <p className="mt-2 text-meta text-text-tertiary">
                  A rumor surfaces here once it's corroborated across posts — or flagged by a tracked
                  leaker. Check back around model-launch season.
                </p>
              </Surface>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {sorted.map((rumor) => (
                    <RumorCard
                      key={`${rumor.model_slug}:${rumor.version_label ?? rumor.codename}`}
                      rumor={rumor}
                    />
                  ))}
                </div>
                <p className="mt-8 max-w-2xl text-meta text-text-tertiary">
                  Likelihood reflects how much corroborating chatter we see across platforms, not an
                  editorial judgment. Dates and benefits are unconfirmed community estimates, not
                  forecasts.
                </p>
              </>
            )}
          </section>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default Rumors;
