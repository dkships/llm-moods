import { ArrowUpRight } from "lucide-react";
import Surface from "@/components/Surface";
import Tag from "@/components/Tag";
import BarList from "@/components/BarList";
import { formatTimeAgo, formatSourceDisplay } from "@/lib/vibes";
import type { PublicRumorRow, RumorClaimType } from "@/hooks/useRumors";

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
  const eta = r.eta_text?.trim();
  if (!eta) return null;
  return `Expected ~${eta}${r.eta_conflicting ? " (estimates vary)" : " · unconfirmed"}`;
}

function safeUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
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

  const platforms = Array.from(
    new Set((rumor.representative_sources ?? []).map((s) => formatSourceDisplay(s.platform).label)),
  );
  const platformCount = Math.max(rumor.platform_count ?? 0, platforms.length);
  const corroboration =
    `${platformCount} platform${platformCount === 1 ? "" : "s"} · ` +
    `${rumor.mention_count} mention${rumor.mention_count === 1 ? "" : "s"}`;

  return (
    <Surface as="article" motion="fade" className="h-full">
      {/* Identity — who */}
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
          <span className="truncate text-mono-cap text-text-secondary">{modelName}</span>
        </span>
        {claim.warn ? (
          <Tag tone="warning">{claim.label}</Tag>
        ) : (
          <span className="shrink-0 text-mono-cap text-text-tertiary">{claim.label}</span>
        )}
      </div>
      <h3 className="mt-1.5 text-section text-foreground">{rumorTitle(rumor)}</h3>

      {/* Claim — what + when */}
      <p className="mt-3 text-body text-text-secondary">{rumor.claim_summary}</p>
      {eta && (
        <p className="mt-3 text-meta">
          <span className="text-text-tertiary">ETA · </span>
          <span className="text-text-secondary">{eta}</span>
        </p>
      )}
      {rumor.rumored_benefit && (
        <p className="mt-2 text-body text-text-secondary">
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

      {/* Evidence — how sure */}
      <div className="mt-5 border-t border-border pt-4">
        <BarList
          accent={accent}
          max={100}
          items={[{ label: "Corroboration", value: strengthPct, secondary: corroboration }]}
        />
        {isSingleSource && (
          <div className="mt-3">
            <Tag tone="warning">single unconfirmed source</Tag>
          </div>
        )}
        {sources.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {sources.map((s) => {
              const href = safeUrl(s.url);
              const meta =
                formatSourceDisplay(s.platform).label +
                (s.handle ? ` · @${s.handle}${s.verified ? " ✓" : ""}` : "") +
                (s.posted_at ? ` · ${formatTimeAgo(s.posted_at)}` : "");
              const inner = (
                <>
                  <span className="truncate">{meta}</span>
                  <ArrowUpRight
                    className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </>
              );
              return (
                <li key={s.url}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center justify-between gap-3 rounded-md text-meta text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {inner}
                    </a>
                  ) : (
                    <span className="flex items-center justify-between gap-3 text-meta text-text-tertiary">
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
