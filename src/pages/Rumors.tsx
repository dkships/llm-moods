import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import Surface from "@/components/Surface";
import Tag from "@/components/Tag";
import ChatterPost from "@/components/ChatterPost";
import useHead from "@/hooks/useHead";
import { useRumors, type PublicRumorRow, type RumorClaimType } from "@/hooks/useRumors";
import { formatTimeAgo, formatSourceDisplay } from "@/lib/vibes";

const MODEL_LABELS: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
};

// Display label + tone for each lifecycle stage. Only `delayed` carries the
// warning tint; the rest stay neutral (this is a rumor board, not a status page).
const CLAIM_TYPE: Record<RumorClaimType, { label: string; tone: "neutral" | "warning" }> = {
  launch: { label: "Rumored launch", tone: "neutral" },
  in_testing: { label: "In testing", tone: "neutral" },
  imminent: { label: "Imminent", tone: "neutral" },
  delayed: { label: "Delayed", tone: "warning" },
  return: { label: "Rumored return", tone: "neutral" },
  other: { label: "Rumored", tone: "neutral" },
};

const modelLabel = (slug: string) => MODEL_LABELS[slug] ?? slug;

function rumorTitle(rumor: PublicRumorRow): string {
  const version = rumor.version_label?.trim();
  const codename = rumor.codename?.trim();
  if (version && codename && codename.toLowerCase() !== version.toLowerCase()) {
    return `${version} (${codename})`;
  }
  return version || codename || "Unnamed model";
}

// Honest, hedged ETA line. Returns null when no source stated a timeframe.
function etaLine(rumor: PublicRumorRow): string | null {
  const eta = rumor.eta_text?.trim();
  if (!eta) return null;
  const suffix = rumor.eta_conflicting ? " (estimates vary)" : " (unconfirmed)";
  return `Community estimate: ~${eta}${suffix}`;
}

// "12 mentions across Reddit · X" — the credibility signal is corroboration
// volume across platforms, derived from the representative sources we kept.
function mentionsLine(rumor: PublicRumorRow): string {
  const platforms = Array.from(
    new Set((rumor.representative_sources ?? []).map((s) => formatSourceDisplay(s.platform).label)),
  );
  const noun = rumor.mention_count === 1 ? "mention" : "mentions";
  const where = platforms.length > 0
    ? `across ${platforms.join(" · ")}`
    : `across ${rumor.platform_count} platform${rumor.platform_count === 1 ? "" : "s"}`;
  return `${rumor.mention_count} ${noun} ${where}`;
}

const RumorCard = ({ rumor }: { rumor: PublicRumorRow }) => {
  const claim = CLAIM_TYPE[rumor.claim_type] ?? CLAIM_TYPE.other;
  const eta = etaLine(rumor);
  const sources = (rumor.representative_sources ?? []).slice(0, 3);

  return (
    <Surface as="article" motion="fade" className="h-full">
      <div className="flex flex-wrap items-center gap-2">
        <Tag>{modelLabel(rumor.model_slug)}</Tag>
        <Tag tone={claim.tone}>{claim.label}</Tag>
        <h2 className="text-section text-foreground">{rumorTitle(rumor)}</h2>
      </div>

      <p className="mt-3 text-body text-text-secondary">{rumor.claim_summary}</p>

      {rumor.rumored_benefit && (
        <p className="mt-3 text-body text-text-secondary">
          <span className="text-text-tertiary">Rumored benefit: </span>
          {rumor.rumored_benefit}
          {!rumor.benefit_verified && <Tag className="ml-1.5">unverified</Tag>}
        </p>
      )}

      {rumor.signals && (
        <p className="mt-2 text-body text-text-secondary">
          <span className="text-text-tertiary">Signals: </span>
          {rumor.signals}
        </p>
      )}

      {eta && <p className="mt-3 text-meta text-text-secondary">{eta}</p>}

      <p className="mt-4 text-mono-cap text-text-tertiary">
        {mentionsLine(rumor)}
        {rumor.last_seen_at && ` · last seen ${formatTimeAgo(rumor.last_seen_at)}`}
      </p>

      {sources.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {sources.map((s) => (
            <ChatterPost
              key={s.url}
              post={{
                id: s.url,
                source: s.platform,
                source_url: s.url,
                title: s.snippet ?? s.handle ?? null,
                content: s.snippet ?? null,
                posted_at: s.posted_at ?? null,
              }}
              extraMeta={s.handle ?? null}
              hideModel
            />
          ))}
        </div>
      )}
    </Surface>
  );
};

const Rumors = () => {
  const { data: rumors, isLoading } = useRumors();

  useHead({
    title: "Rumors — LLM Vibes",
    description:
      "Aggregated community chatter about unreleased AI models — what's being discussed, when it's expected, and the signals behind it. Unconfirmed estimates, not forecasts.",
    url: "/rumors",
  });

  const sorted = [...(rumors ?? [])].sort(
    (a, b) => b.platform_count - a.platform_count || b.mention_count - a.mention_count,
  );

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          <section className="container pt-10 pb-8 animate-fade-in">
            <h1 className="text-page text-foreground">Rumors</h1>
            <p className="mt-2 max-w-2xl text-meta text-text-secondary">
              What the community is saying about unreleased Claude, ChatGPT, Gemini, and Grok models —
              the next version, its stage, expected timing, and the signals behind it. Likelihood
              reflects how much corroborating chatter we see across platforms, not an editorial
              judgment. Dates are unconfirmed community estimates, not forecasts.
            </p>
          </section>

          <section className="container pb-12">
            {isLoading ? (
              <p className="text-body text-text-tertiary">Loading…</p>
            ) : sorted.length === 0 ? (
              <Surface motion="fade">
                <p className="text-body text-text-secondary">No strong rumors right now.</p>
                <p className="mt-2 text-meta text-text-tertiary">
                  A rumor appears here once at least two independent posts corroborate it. Check back
                  around model-launch season.
                </p>
              </Surface>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {sorted.map((rumor) => (
                  <RumorCard key={`${rumor.model_slug}:${rumor.version_label ?? rumor.codename}`} rumor={rumor} />
                ))}
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
