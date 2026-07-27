import PageHeader from "@/components/PageHeader";
import Surface from "@/components/Surface";
import RumorCard from "@/components/rumors/RumorCard";
import { RumorCardSkeleton } from "@/components/Skeletons";
import useHead from "@/hooks/useHead";
import { useRumors } from "@/hooks/useRumors";
import { useModelsWithLatestVibes } from "@/hooks/useVibesData";
import { rumorStrengthScore } from "../../supabase/functions/_shared/rumor-canon";

const MODEL_LABELS: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
};

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

  // Concrete artifacts and vetted reporting lead; independent corroboration and
  // recency break ties. The same score drives the relative card meter.
  const sorted = [...(rumors ?? [])].sort(
    (a, b) =>
      rumorStrengthScore(b) - rumorStrengthScore(a) ||
      (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? ""),
  );
  const boardMax = Math.max(...sorted.map(rumorStrengthScore), 1);

  return (
    <>
          <section className="container pb-8 pt-10 sm:pt-12">
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
              <Surface className="max-w-2xl">
                <p className="py-8 text-center text-body text-text-tertiary" role="status" aria-live="polite">
                  Couldn't load rumors right now. Refresh to try again.
                </p>
              </Surface>
            ) : sorted.length === 0 ? (
              <Surface className="max-w-2xl">
                <p className="text-body text-text-secondary">No strong rumors right now.</p>
                <p className="mt-2 text-meta text-text-tertiary">
                  A rumor surfaces here once it's independently corroborated or backed by a vetted
                  source or observed artifact. Check back around model-launch season.
                </p>
              </Surface>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {sorted.map((rumor) => {
                  const m = brand.get(rumor.model_slug);
                  return (
                    <RumorCard
                      key={`${rumor.model_slug}:${rumor.version_label ?? rumor.codename}`}
                      rumor={rumor}
                      accent={m?.accent_color ?? "#888"}
                      modelName={m?.name ?? MODEL_LABELS[rumor.model_slug] ?? rumor.model_slug}
                      strengthPct={Math.round((rumorStrengthScore(rumor) / boardMax) * 100)}
                      // A lone rumor would otherwise sit half-width with an
                      // empty cell beside it; ResearchIndex spans its featured
                      // card for the same reason.
                      className={sorted.length === 1 ? "md:col-span-2" : undefined}
                    />
                  );
                })}
              </div>
            )}
          </section>
    </>
  );
};

export default Rumors;
