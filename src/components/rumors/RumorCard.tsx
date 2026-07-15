import Surface from "@/components/Surface";
import Tag from "@/components/Tag";
import { formatTimeAgo, formatSourceDisplay } from "@/lib/vibes";
import { getSafeExternalUrl } from "@/lib/safe-url";
import { formatRumorEta } from "@/lib/rumor-eta";
import type { PublicRumorRow, RumorClaimType, RumorSourceRef } from "@/hooks/useRumors";
import { inferSourceQuality, sourceQualityLabel } from "../../../supabase/functions/_shared/rumor-canon";

// Display label + warning flag per lifecycle stage. Only `delayed` carries a
// warning tint; every other stage is a quiet mono-cap eyebrow — this is a rumor
// board, not a status page.
const CLAIM_TYPE: Record<RumorClaimType, { label: string; warn: boolean }> = {
  launch: { label: "Rumored launch", warn: false },
  in_testing: { label: "In testing", warn: false },
  imminent: { label: "Imminent", warn: false },
  delayed: { label: "Delayed", warn: true },
  return: { label: "Rumored return", warn: false },
  other: { label: "Rumored", warn: false },
};

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
  const eta = formatRumorEta(r);
  if (!eta) return null;
  return `${eta}${r.eta_conflicting ? " (estimates vary)" : " · unconfirmed"}`;
}

function sourceContextLabel(source: RumorSourceRef): string | null {
  const quality = inferSourceQuality(source);
  return quality === "unknown" ? null : sourceQualityLabel(quality);
}

interface RumorCardProps {
  rumor: PublicRumorRow;
  /** Per-model brand color (the one allowed accent use — dot + meter fill). */
  accent: string;
  /** Resolved display name, e.g. "ChatGPT". */
  modelName: string;
  /** Corroboration bar length (0–100), normalized against the board's top card. */
  strengthPct: number;
}

const RumorCard = ({ rumor, accent, modelName, strengthPct }: RumorCardProps) => {
  const claim = CLAIM_TYPE[rumor.claim_type] ?? CLAIM_TYPE.other;
  const eta = etaLabel(rumor);
  const isSingleSource = rumor.mention_count < 2;
  const sources = (rumor.representative_sources ?? []).slice(0, 3);
  const leadContext = sources.some((source) => source.evidence_kind === "artifact")
    ? "artifact signal"
    : sources.map(sourceContextLabel).find(Boolean);

  const platforms = Array.from(
    new Set((rumor.representative_sources ?? []).map((s) => formatSourceDisplay(s.platform).label)),
  );
  const platformCount = Math.max(rumor.platform_count ?? 0, platforms.length);

  return (
    <Surface as="article" className="flex h-full flex-col">
      {/* Header: model + claim */}
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
          <span className="truncate text-mono-cap text-text-secondary">{modelName}</span>
        </span>
        <Tag tone={claim.warn ? "warning" : "neutral"} className="shrink-0">
          {claim.label}
        </Tag>
      </div>

      {/* Title + ETA lockup */}
      <h3 className="mt-3 text-section text-foreground">{rumorTitle(rumor)}</h3>
      {eta && (
        <p className="mt-1 text-meta text-text-tertiary">{eta}</p>
      )}

      {/* Summary */}
      <p className="mt-4 text-body text-text-secondary">{rumor.claim_summary}</p>

      {/* Details — quiet definition list; only render if present */}
      {(rumor.rumored_benefit || rumor.signals) && (
        <dl className="mt-5 space-y-3">
          {rumor.rumored_benefit && (
            <div>
              <dt className="text-mono-cap text-text-tertiary">
                Rumored benefit
                {!rumor.benefit_verified && <Tag className="ml-1.5">unverified</Tag>}
              </dt>
              <dd className="mt-1 text-body text-text-secondary">{rumor.rumored_benefit}</dd>
            </div>
          )}
          {rumor.signals && (
            <div>
              <dt className="text-mono-cap text-text-tertiary">Signals</dt>
              <dd className="mt-1 text-body text-text-secondary">{rumor.signals}</dd>
            </div>
          )}
        </dl>
      )}

      {/* Evidence footer — pushed to bottom for equal-height cards */}
      <div className="mt-6 flex-1" />
      <div className="border-t border-border pt-4">
        {/* Corroboration line: thin meter + inline counts */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-mono-cap text-text-tertiary">Corroboration</span>
          {isSingleSource ? (
            <Tag tone="warning" className="shrink-0">single vetted source</Tag>
          ) : (
            <span className="text-meta text-text-tertiary">
              {rumor.mention_count} sources · {platformCount} platform{platformCount === 1 ? "" : "s"}
              {leadContext && <> · <span className="text-text-secondary">{leadContext}</span></>}
            </span>
          )}
        </div>
        <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-border/60">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.max(4, strengthPct)}%`, background: accent }}
            aria-hidden
          />
        </div>

        {/* Sources as inline chips */}
        {sources.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {sources.map((s) => {
              const href = getSafeExternalUrl(s.url);
              const platform = formatSourceDisplay(s.platform).label;
              const handle = s.handle ? `@${s.handle}` : platform;
              const when = s.posted_at ? formatTimeAgo(s.posted_at) : null;
              const title = [
                s.handle ? `@${s.handle}${s.verified ? " ✓" : ""}` : null,
                platform,
                sourceContextLabel(s),
                when,
              ].filter(Boolean).join(" · ");
              const chipClasses =
                "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface/60 px-2.5 py-1 text-meta text-text-secondary transition-colors";
              const inner = (
                <>
                  <span className="truncate">{handle}</span>
                  {s.verified && s.handle && (
                    <span className="text-text-tertiary" aria-label="verified">✓</span>
                  )}
                  <span className="text-text-tertiary">·</span>
                  <span className="shrink-0 text-text-tertiary">{platform}</span>
                  {when && (
                    <>
                      <span className="text-text-tertiary">·</span>
                      <span className="shrink-0 text-text-tertiary">{when}</span>
                    </>
                  )}
                </>
              );
              return (
                <li key={s.url} className="max-w-full">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={title}
                      className={`${chipClasses} hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
                    >
                      {inner}
                    </a>
                  ) : (
                    <span className={chipClasses}>{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Surface>
  );
};

export default RumorCard;
