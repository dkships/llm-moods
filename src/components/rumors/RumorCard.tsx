import { ArrowUpRight } from "lucide-react";
import Surface from "@/components/Surface";
import Tag from "@/components/Tag";
import BarList from "@/components/BarList";
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
  const corroboration =
    (leadContext ? `${leadContext} · ` : "") +
    `${platformCount} platform${platformCount === 1 ? "" : "s"} · ` +
    `${rumor.mention_count} independent source${rumor.mention_count === 1 ? "" : "s"}`;

  return (
    <Surface as="article" className="h-full">
      {/* Identity — who */}
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
          <span className="truncate text-mono-cap text-text-secondary">{modelName}</span>
        </span>
        <Tag tone={claim.warn ? "warning" : "neutral"} className="shrink-0">
          {claim.label}
        </Tag>
      </div>
      <h3 className="mt-2 text-section text-foreground">{rumorTitle(rumor)}</h3>

      {/* Claim — what + when */}
      <p className="mt-3 text-body text-text-secondary">{rumor.claim_summary}</p>
      {eta && (
        <p className="mt-3 text-meta">
          <span className="text-text-tertiary">ETA · </span>
          <span className="text-text-secondary">{eta}</span>
        </p>
      )}
      {rumor.rumored_benefit && (
        <p className="mt-3 text-body text-text-secondary">
          <span className="text-text-tertiary">Rumored benefit · </span>
          {rumor.rumored_benefit}
          {!rumor.benefit_verified && <Tag className="ml-1.5">unverified</Tag>}
        </p>
      )}
      {rumor.signals && (
        <p className="mt-3 text-body text-text-secondary">
          <span className="text-text-tertiary">Signals · </span>
          {rumor.signals}
        </p>
      )}

      {/* Evidence — how sure */}
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <BarList
              accent={accent}
              max={100}
              secondaryLayout="stacked-mobile"
              items={[{ label: "Corroboration", value: strengthPct, secondary: corroboration }]}
            />
          </div>
          {isSingleSource && (
            <Tag tone="warning" className="mt-0.5 shrink-0">
              single vetted source
            </Tag>
          )}
        </div>
        {sources.length > 0 && (
          <ul className="mt-3 divide-y divide-border/60 border-t border-border/60">
            {sources.map((s) => {
              const href = getSafeExternalUrl(s.url);
              const context = sourceContextLabel(s);
              const platform = formatSourceDisplay(s.platform).label;
              const handle = s.handle ? `@${s.handle}` : null;
              const when = s.posted_at ? formatTimeAgo(s.posted_at) : null;
              const inner = (
                <>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-text-secondary">
                      {handle ?? platform}
                      {handle && s.verified && (
                        <span className="ml-1 text-text-tertiary" aria-label="verified">✓</span>
                      )}
                    </span>
                    {handle && (
                      <span className="shrink-0 text-text-tertiary">{platform}</span>
                    )}
                    {context && (
                      <span className="hidden shrink-0 text-text-tertiary sm:inline">· {context}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-text-tertiary">
                    {when && <span>{when}</span>}
                    <ArrowUpRight
                      className="h-3.5 w-3.5 opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden
                    />
                  </span>
                </>
              );
              return (
                <li key={s.url}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center justify-between gap-3 py-2 text-meta transition-colors hover:bg-surface-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&>*:first-child>span:first-child]:group-hover:text-foreground"
                    >
                      {inner}
                    </a>
                  ) : (
                    <span className="flex items-center justify-between gap-3 py-2 text-meta">
                      {inner}
                    </span>
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
