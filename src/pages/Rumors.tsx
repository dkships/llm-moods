import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import PageHeader from "@/components/PageHeader";
import Surface from "@/components/Surface";
import RumorCard from "@/components/rumors/RumorCard";
import { RumorCardSkeleton } from "@/components/Skeletons";
import useHead from "@/hooks/useHead";
import { useRumors } from "@/hooks/useRumors";
import { useModelsWithLatestVibes } from "@/hooks/useVibesData";

const MODEL_LABELS: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
};

// Blended corroboration strength matching the card sort: platform breadth
// dominates, mention volume breaks ties. Drives the bar length only — the
// caption always shows real counts.
const strengthOf = (r: { platform_count: number; mention_count: number }) =>
  (r.platform_count ?? 0) * 1000 + (r.mention_count ?? 0);

const Rumors = () => {
  const { data: rumors, isLoading, isError } = useRumors();
  const { data: models } = useModelsWithLatestVibes();

  useHead({
    title: "Rumors — LLM Vibes",
    description:
      "Aggregated community chatter about unreleased AI models — what's being discussed, when it's expected, and the signals behind it. Unconfirmed estimates, not forecasts.",
    url: "/rumors",
  });

  const brand = new Map((models ?? []).map((m) => [m.slug, m]));

  // Strongest corroboration first; recency breaks ties.
  const sorted = [...(rumors ?? [])].sort(
    (a, b) =>
      b.platform_count - a.platform_count ||
      b.mention_count - a.mention_count ||
      (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? ""),
  );
  const boardMax = Math.max(...sorted.map(strengthOf), 1);

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          <section className="container pt-10 pb-8 animate-fade-in">
            <PageHeader
              title="Rumors"
              description="What the community is saying about unreleased Claude, ChatGPT, Gemini, and Grok models — the next version, its stage, and when it's rumored to land. Unconfirmed community estimates, not forecasts."
            />
          </section>

          <section className="container pb-12">
            {isLoading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2" role="status" aria-live="polite">
                <span className="sr-only">Loading rumors…</span>
                {Array.from({ length: 4 }).map((_, i) => (
                  <RumorCardSkeleton key={i} />
                ))}
              </div>
            ) : isError ? (
              <Surface motion="fade" className="max-w-2xl">
                <p className="py-8 text-center text-body text-text-tertiary" role="status" aria-live="polite">
                  Couldn't load rumors right now. Refresh to try again.
                </p>
              </Surface>
            ) : sorted.length === 0 ? (
              <Surface motion="fade" className="max-w-2xl">
                <p className="text-body text-text-secondary">No strong rumors right now.</p>
                <p className="mt-2 text-meta text-text-tertiary">
                  A rumor surfaces here once it's corroborated across posts — or flagged by a tracked
                  source. Check back around model-launch season.
                </p>
              </Surface>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 animate-fade-in">
                {sorted.map((rumor) => {
                  const m = brand.get(rumor.model_slug);
                  return (
                    <RumorCard
                      key={`${rumor.model_slug}:${rumor.version_label ?? rumor.codename}`}
                      rumor={rumor}
                      accent={m?.accent_color ?? "#888"}
                      modelName={m?.name ?? MODEL_LABELS[rumor.model_slug] ?? rumor.model_slug}
                      strengthPct={Math.round((strengthOf(rumor) / boardMax) * 100)}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default Rumors;
