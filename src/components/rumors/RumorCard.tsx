import Surface from "@/components/Surface";
import Tag from "@/components/Tag";
import ChatterPost from "@/components/ChatterPost";
import { formatTimeAgo, formatSourceDisplay } from "@/lib/vibes";
import type { PublicRumorRow, RumorClaimType } from "@/hooks/useRumors";

const MODEL_LABELS: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
};

// Display label + tone per lifecycle stage. Only `delayed` carries the warning
// tint; the rest stay neutral — this is a rumor board, not a status page.
const CLAIM_TYPE: Record<RumorClaimType, { label: string; tone: "neutral" | "warning" }> = {
  launch: { label: "Rumored launch", tone: "neutral" },
  in_testing: { label: "In testing", tone: "neutral" },
  imminent: { label: "Imminent", tone: "neutral" },
  delayed: { label: "Delayed", tone: "warning" },
  return: { label: "Rumored return", tone: "neutral" },
  other: { label: "Rumored", tone: "neutral" },
};

const modelLabel = (slug: string) => MODEL_LABELS[slug] ?? slug;

function rumorTitle(r: PublicRumorRow): string {
  const version = r.version_label?.trim();
  const codename = r.codename?.trim();
  if (version && codename && codename.toLowerCase() !== version.toLowerCase()) {
    return `${version} · ${codename}`;
  }
  return version || codename || "Unnamed model";
}

// Hedged ETA line; null when no source stated a timeframe.
function etaLabel(r: PublicRumorRow): string | null {
  const eta = r.eta_text?.trim();
  if (!eta) return null;
  return `Expected ~${eta}${r.eta_conflicting ? " (estimates vary)" : " · unconfirmed"}`;
}

// "4 mentions across Reddit · X" — corroboration volume is the credibility signal.
function mentionsLabel(r: PublicRumorRow): string {
  const platforms = Array.from(
    new Set((r.representative_sources ?? []).map((s) => formatSourceDisplay(s.platform).label)),
  );
  const noun = r.mention_count === 1 ? "mention" : "mentions";
  const where = platforms.length > 0
    ? `across ${platforms.join(" · ")}`
    : `across ${r.platform_count} platform${r.platform_count === 1 ? "" : "s"}`;
  return `${r.mention_count} ${noun} ${where}`;
}

const RumorCard = ({ rumor }: { rumor: PublicRumorRow }) => {
  const claim = CLAIM_TYPE[rumor.claim_type] ?? CLAIM_TYPE.other;
  const eta = etaLabel(rumor);
  const sources = (rumor.representative_sources ?? []).slice(0, 3);
  const lead = sources.find((s) => s.handle);
  const isSingleSource = rumor.mention_count < 2;

  return (
    <Surface as="article" motion="fade" className="h-full">
      <div className="flex flex-wrap items-center gap-2">
        <Tag>{modelLabel(rumor.model_slug)}</Tag>
        <Tag tone={claim.tone}>{claim.label}</Tag>
        {isSingleSource && <Tag tone="warning">single unconfirmed source</Tag>}
      </div>

      <h3 className="mt-3 text-section text-foreground">{rumorTitle(rumor)}</h3>
      <p className="mt-2 text-body text-text-secondary">{rumor.claim_summary}</p>

      {eta && <p className="mt-3 text-meta text-text-secondary">{eta}</p>}

      {rumor.rumored_benefit && (
        <p className="mt-3 text-body text-text-secondary">
          <span className="text-text-tertiary">Rumored benefit · </span>
          {rumor.rumored_benefit}
          {!rumor.benefit_verified && <Tag className="ml-1.5">unverified</Tag>}
        </p>
      )}
      {rumor.signals && (
        <p className="mt-2 text-body text-text-secondary">
          <span className="text-text-tertiary">Signals · </span>
          {rumor.signals}
        </p>
      )}

      <p className="mt-4 text-mono-cap text-text-tertiary">
        {mentionsLabel(rumor)}
        {lead?.handle && ` · via @${lead.handle}${lead.verified ? " ✓" : ""}`}
        {rumor.last_seen_at && ` · ${formatTimeAgo(rumor.last_seen_at)}`}
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
              extraMeta={s.handle ? `@${s.handle}${s.verified ? " ✓" : ""}` : null}
              hideModel
            />
          ))}
        </div>
      )}
    </Surface>
  );
};

export default RumorCard;
