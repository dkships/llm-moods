// Pure (Deno-free) rollup/merge helpers for the upcoming-model rumors radar.
// Shared between the `aggregate-rumors` edge function and its vitest unit tests,
// so this file must NOT import anything Deno-specific.
//
// The canonicalization + frontier-filtering it leans on lives in the zero-import
// sibling `rumor-canon.ts` (also used by the frontend display merge).
//
// The accumulator model: `model_rumors` is keyed by (model_slug, version_key) and
// updated incrementally each run. `mention_count` counts DISTINCT source_url ever
// seen — and since a post is extracted exactly once (the `rumor_checked_at` gate),
// a url contributes to exactly one run, so we can safely add this run's distinct
// new urls without double-counting.

import {
  TRACKED_LEAKER_HANDLES,
  canonicalVersionKey,
  inferSourceQuality,
  isNonFrontierLabel,
  isReleasedVersion,
  sourceQualityRank,
  type SourceQuality,
  squash,
} from "./rumor-canon.ts";

export type RumorClaimType =
  | "launch"
  | "in_testing"
  | "imminent"
  | "delayed"
  | "return"
  | "other";

export type TargetFamily = "claude" | "chatgpt" | "gemini" | "grok";

/** Raw claim as emitted by the Haiku `record_rumors` tool (untrusted shape). */
export interface RawClaim {
  is_rumor?: boolean;
  target_family?: string;
  version_label?: string | null;
  codename?: string | null;
  is_unreleased?: boolean;
  claim_type?: string;
  claim_summary?: string;
  rumored_benefit?: string | null;
  signals?: string | null;
  eta_text?: string | null;
  eta_date?: string | null;
  confidence?: number;
}

/** Self-contained source reference stored in `representative_sources` (jsonb). */
export interface SourceRef {
  url: string;
  handle?: string | null;
  platform: string;
  snippet?: string | null;
  posted_at?: string | null;
  score?: number | null;
  /** Author credibility signals (Twitter-only; null elsewhere). */
  verified?: boolean | null;
  followers?: number | null;
  /** Tweet id this post quotes, if any (Twitter-only) — used to drop echoes. */
  quotedStatusId?: string | null;
  /** Display/source-quality context inferred from handle, domain, or source type. */
  source_quality?: SourceQuality | null;
}

// Tracked leaker handles (lowercased, no @). EPHEMERAL — refresh each model cycle
// alongside the codename `model_keywords` and the RELEASED_SET in aggregate-rumors.
// The matching `from:<handle>` Twitter search terms live in scraper_config.
export const KNOWN_LEAKERS = TRACKED_LEAKER_HANDLES;

const VERIFIED_FOLLOWER_FLOOR = 10000;
const HIGH_ENGAGEMENT_FLOOR = 250;

/**
 * A source is "credible" if it's a tracked leaker, curated press scoop,
 * official/artifact evidence, an established verified account, or cleared a
 * high engagement bar (the proxy for platforms with no author data, e.g. a
 * heavily-upvoted Reddit post). A paid/verified checkmark alone is not enough.
 */
function hasCredibleAccount(s: SourceRef): boolean {
  return s.verified === true && (s.followers ?? 0) >= VERIFIED_FOLLOWER_FLOOR;
}

export function isCredibleSource(s: SourceRef): boolean {
  const quality = inferSourceQuality(s);
  return (
    quality === "official" ||
    quality === "tracked_leaker" ||
    quality === "press_scoop" ||
    quality === "artifact_leak" ||
    hasCredibleAccount(s) ||
    (s.score ?? 0) >= HIGH_ENGAGEMENT_FLOOR
  );
}

// Higher rank = more authoritative; used to order representative_sources so a
// tracked-leaker / verified tweet leads even when a Reddit post has more upvotes.
function credibilityRank(s: SourceRef): number {
  const qualityRank = sourceQualityRank(s) * 10;
  const accountRank = hasCredibleAccount(s) ? 15 : 0;
  const engagementRank = (s.score ?? 0) >= HIGH_ENGAGEMENT_FLOOR ? 10 : 0;
  return Math.max(qualityRank, accountRank, engagementRank);
}

/** A validated claim attached to its source, ready to roll up. */
export interface RumorContribution {
  modelSlug: TargetFamily;
  versionKey: string;
  versionLabel: string | null;
  codename: string | null;
  claimType: RumorClaimType;
  claimSummary: string;
  rumoredBenefit: string | null;
  signals: string | null;
  etaText: string | null;
  etaDate: string | null;
  confidence: number;
  source: SourceRef;
}

/** The persisted `model_rumors` row shape (accumulator). */
export interface RumorRow {
  model_slug: string;
  version_key: string;
  version_label: string | null;
  codename: string | null;
  claim_type: RumorClaimType;
  claim_summary: string;
  rumored_benefit: string | null;
  benefit_verified: boolean;
  signals: string | null;
  eta_text: string | null;
  eta_date: string | null;
  eta_conflicting: boolean;
  mention_count: number;
  platforms: string[];
  representative_sources: SourceRef[];
  has_credible_source: boolean;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

const VALID_FAMILIES = new Set<TargetFamily>(["claude", "chatgpt", "gemini", "grok"]);
const VALID_CLAIM_TYPES = new Set<RumorClaimType>([
  "launch",
  "in_testing",
  "imminent",
  "delayed",
  "return",
  "other",
]);

// Highest precedence first. `delayed` and `return` are "sticky" lifecycle states
// that should win over an older `launch`/`in_testing` once they've been observed.
export const CLAIM_TYPE_PRECEDENCE: RumorClaimType[] = [
  "delayed",
  "return",
  "imminent",
  "in_testing",
  "launch",
  "other",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function cleanStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function ts(v: string | null | undefined): number {
  if (!v) return 0;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : 0;
}

function firstNonNull(values: (string | null)[]): string | null {
  for (const v of values) if (v) return v;
  return null;
}

function etaKey(v: string | null | undefined): string | null {
  const q = squash(v);
  return q.length > 0 ? q : null;
}

function maxTs(values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of values) if (v && ts(v) >= ts(best)) best = v;
  return best;
}

function minTs(values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (best === null || ts(v) < ts(best))) best = v;
  return best;
}

export function normalizeVersionKey(
  label: string | null | undefined,
  codename: string | null | undefined,
): string | null {
  const raw = (label || codename || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return raw.length >= 2 ? raw : null;
}

function clampConfidence(c: unknown): number {
  const n = typeof c === "number" ? c : Number(c);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function withSourceQuality<T extends SourceRef>(source: T): T {
  return { ...source, source_quality: inferSourceQuality(source) } as T;
}

/**
 * Validate one raw claim against its source post; returns null if it should be
 * dropped. Drops: non-rumors, released versions, unknown/invalid family, claims
 * with no version/codename, and — anti-hallucination — a `version_label` that
 * does not actually appear in the post text.
 */
export function buildContribution(
  raw: RawClaim,
  source: SourceRef,
  postText: string,
): RumorContribution | null {
  if (!raw || raw.is_rumor === false) return null;
  if (raw.is_unreleased === false) return null;

  const family = String(raw.target_family ?? "").toLowerCase() as TargetFamily;
  if (!VALID_FAMILIES.has(family)) return null;

  const versionLabel = cleanStr(raw.version_label);
  const codename = cleanStr(raw.codename);

  // Anti-hallucination: a stated version token must appear in the post — compared
  // punctuation-insensitively so a label of "GPT-5.6" still matches a post that
  // wrote "GPT-5,6" (the strict substring check used to drop these).
  const squashedLabel = squash(versionLabel);
  if (squashedLabel.length >= 2 && !squash(postText).includes(squashedLabel)) {
    return null;
  }

  // Drop competitor / non-family labels (e.g. "DeepSeek V3" mis-attributed to a
  // tracked family). Codename-only claims stay — discovery is preserved.
  if (isNonFrontierLabel(family, versionLabel, codename)) return null;

  // Canonicalize so alias spellings (Fable / Mythos / Mythos 5 / "Mythos/Fable 5")
  // collapse to one (model_slug, version_key) row at write-time.
  const canon = canonicalVersionKey(family, versionLabel, codename);
  if (!canon.key) return null;

  // Drop versions that have now shipped — the radar tracks unreleased models only.
  // Deterministic (doesn't trust the LLM's is_unreleased), and it also retires any
  // row already persisted before the version launched via the display/RPC filters.
  if (isReleasedVersion(family, canon.label, canon.codename)) return null;

  const claimType = (VALID_CLAIM_TYPES.has(raw.claim_type as RumorClaimType)
    ? (raw.claim_type as RumorClaimType)
    : "other");

  return {
    modelSlug: family,
    versionKey: canon.key,
    versionLabel: canon.label,
    codename: canon.codename,
    claimType,
    claimSummary: cleanStr(raw.claim_summary) ?? "Discussed as an upcoming release.",
    rumoredBenefit: cleanStr(raw.rumored_benefit),
    signals: cleanStr(raw.signals),
    etaText: cleanStr(raw.eta_text),
    etaDate: cleanStr(raw.eta_date),
    confidence: clampConfidence(raw.confidence),
    source: withSourceQuality(source),
  };
}

/**
 * Map the `record_rumors` tool output (`posts[]` keyed by `index`) back to the
 * input batch. Returns claims[] per input index (empty array when the model
 * omitted an index — a short array is NOT padded with anything load-bearing).
 */
export function parseRecordRumors(input: unknown, batchLength: number): RawClaim[][] {
  const out: RawClaim[][] = Array.from({ length: batchLength }, () => []);
  const posts = isRecord(input) && Array.isArray(input.posts) ? input.posts : [];
  for (const p of posts) {
    if (!isRecord(p)) continue;
    const idx = typeof p.index === "number" ? p.index : Number(p.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= batchLength) continue;
    out[idx] = (Array.isArray(p.claims) ? p.claims : []).filter(isRecord) as RawClaim[];
  }
  return out;
}

const GPT56_RE = /\bgpt[-\s]?5[.,]\s*6\b/i;
const GEMINI_35_PRO_RE = /\b(?:gemini\s*)?3[.,]\s*5\s*pro\b/i;
const DELAY_RE = /\b(?:delays?|delayed|pushed back|slipped|postponed|stalled|no longer|give us until)\b/i;
const TESTING_RE = /\b(?:in testing|early access|\bEAP\b|enterprise partners?|partner testing|testing ahead of|canary|spotted|api|arena|model[-\s]?(?:string|id)|codename)\b/i;
const IMMINENT_RE = /\b(?:imminent|eta|next week|this week|any day now|coming soon|dropping|drops? (?:next|this)|rolling out|rolls? out|scheduled|wider launch)\b/i;
const PARTNER_TESTING_RE =
  /\b(?:launch(?:ed)? for .{0,80}testing|enterprise partners? for testing|testing ahead of (?:the )?(?:wider|public|general) launch)\b/i;

function backstopEligible(source: SourceRef): boolean {
  return isCredibleSource(source);
}

function compactWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function windowAround(text: string, match: RegExpExecArray | null, radius = 180): string {
  if (!match) return text.slice(0, radius * 2);
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return text.slice(start, end);
}

function claimScope(text: string, match: RegExpExecArray | null): string {
  if (!match) return windowAround(text, match);
  const left = Math.max(
    text.lastIndexOf("\n", match.index - 1),
    text.lastIndexOf(". ", match.index - 1),
    text.lastIndexOf("; ", match.index - 1),
  );
  const rightCandidates = [
    text.indexOf("\n", match.index + match[0].length),
    text.indexOf(".", match.index + match[0].length),
    text.indexOf("; ", match.index + match[0].length),
  ].filter((idx) => idx >= 0);
  const right = rightCandidates.length > 0 ? Math.min(...rightCandidates) : -1;
  if (right > left && right - left <= 360) {
    return text.slice(left + 1, right + 1);
  }
  return windowAround(text, match);
}

function etaFromText(text: string): string | null {
  if (/\b(?:the\s+)?(?:2nd|second)\s+week\s+of\s+july\b/i.test(text)) return "2nd week of July";
  if (/\bmid[-\s]?july\b/i.test(text)) return "mid-July";
  if (/\bnext week\b/i.test(text)) return "next week";
  if (/\bthis week\b/i.test(text)) return "this week";
  if (/\binto july\b/i.test(text)) return "into July";
  if (/\bjuly\b/i.test(text)) return "July";
  return null;
}

function geminiClaimType(text: string): RumorClaimType | null {
  if (DELAY_RE.test(text)) return "delayed";
  if (TESTING_RE.test(text)) return "in_testing";
  if (IMMINENT_RE.test(text)) return "imminent";
  if (/\b(?:rumou?red?|leaked?|incoming|release date)\b/i.test(text)) return "launch";
  return null;
}

/**
 * Deterministic recovery for high-quality multi-claim posts where the extractor
 * can miss one obvious bullet. Kept intentionally narrow: current backstops only
 * cover the observed GPT-5.6 delay and Gemini 3.5 Pro variant.
 */
export function recoverDeterministicClaims(source: SourceRef, postText: string): RawClaim[] {
  if (!backstopEligible(source)) return [];
  const text = (postText ?? "").trim();
  if (!compactWhitespace(text)) return [];

  const claims: RawClaim[] = [];

  const gptMatch = GPT56_RE.exec(text);
  if (gptMatch) {
    const gptWindow = claimScope(text, gptMatch);
    if (DELAY_RE.test(gptWindow) || DELAY_RE.test(text)) {
      const eta = etaFromText(gptWindow) ?? etaFromText(text);
      claims.push({
        is_rumor: true,
        target_family: "chatgpt",
        version_label: "GPT-5.6",
        codename: null,
        is_unreleased: true,
        claim_type: "delayed",
        claim_summary: eta ? `GPT-5.6 is delayed to ${eta}.` : "GPT-5.6 is delayed.",
        rumored_benefit: null,
        signals: "Tracked source delay claim",
        eta_text: eta,
        eta_date: null,
        confidence: 0.85,
      });
    } else if (PARTNER_TESTING_RE.test(text)) {
      const eta = etaFromText(text);
      claims.push({
        is_rumor: true,
        target_family: "chatgpt",
        version_label: "GPT-5.6",
        codename: null,
        is_unreleased: true,
        claim_type: "in_testing",
        claim_summary: "GPT-5.6 is in enterprise partner testing ahead of wider launch.",
        rumored_benefit: null,
        signals: "Tracked source enterprise partner testing claim",
        eta_text: eta,
        eta_date: null,
        confidence: 0.85,
      });
    }
  }

  const geminiMatch = GEMINI_35_PRO_RE.exec(text);
  if (geminiMatch) {
    const geminiWindow = claimScope(text, geminiMatch);
    const claimType = geminiClaimType(geminiWindow);
    if (claimType) {
      const eta = etaFromText(geminiWindow) ?? etaFromText(text);
      const matchedLabel = compactWhitespace(geminiMatch[0]);
      const versionLabel = /^gemini/i.test(matchedLabel) ? "Gemini 3.5 Pro" : "3.5 Pro";
      claims.push({
        is_rumor: true,
        target_family: "gemini",
        version_label: versionLabel,
        codename: null,
        is_unreleased: true,
        claim_type: claimType,
        claim_summary:
          claimType === "delayed"
            ? (eta ? `Gemini 3.5 Pro is delayed to ${eta}.` : "Gemini 3.5 Pro is delayed.")
            : claimType === "in_testing"
              ? "Gemini 3.5 Pro is being discussed as in testing."
              : claimType === "imminent"
                ? "Gemini 3.5 Pro is being discussed as imminent."
                : "Gemini 3.5 Pro is being discussed as an upcoming release.",
        rumored_benefit: null,
        signals: "Tracked source multi-claim post",
        eta_text: eta,
        eta_date: null,
        confidence: 0.75,
      });
    }
  }

  return claims;
}

function mergeSources(
  existing: SourceRef[],
  incoming: SourceRef[],
  maxSources: number,
): SourceRef[] {
  const byUrl = new Map<string, SourceRef>();
  for (const s of [...existing, ...incoming]) if (s?.url) byUrl.set(s.url, withSourceQuality(s));
  return [...byUrl.values()]
    .sort((a, b) => credibilityRank(b) - credibilityRank(a) || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, maxSources);
}

interface LeadClaim {
  claimType: RumorClaimType;
  claimSummary: string;
  rumoredBenefit: string | null;
  signals: string | null;
  etaText: string | null;
  etaDate: string | null;
  confidence: number;
  source: SourceRef | null;
}

function claimTypeRank(type: RumorClaimType): number {
  const index = CLAIM_TYPE_PRECEDENCE.indexOf(type);
  return index >= 0 ? CLAIM_TYPE_PRECEDENCE.length - index : 0;
}

function compareLeadClaims(a: LeadClaim, b: LeadClaim): number {
  const claimDelta = claimTypeRank(b.claimType) - claimTypeRank(a.claimType);
  if (claimDelta !== 0) return claimDelta;
  const sourceDelta = credibilityRank(b.source ?? emptySource()) - credibilityRank(a.source ?? emptySource());
  if (sourceDelta !== 0) return sourceDelta;
  const timeDelta = ts(b.source?.posted_at) - ts(a.source?.posted_at);
  if (timeDelta !== 0) return timeDelta;
  return b.confidence - a.confidence;
}

function emptySource(): SourceRef {
  return { url: "", platform: "unknown", source_quality: "unknown" };
}

function leadFromContribution(c: RumorContribution): LeadClaim {
  return {
    claimType: c.claimType,
    claimSummary: c.claimSummary,
    rumoredBenefit: c.rumoredBenefit,
    signals: c.signals,
    etaText: c.etaText,
    etaDate: c.etaDate,
    confidence: c.confidence,
    source: c.source,
  };
}

function leadFromExisting(existing: RumorRow): LeadClaim {
  const source = existing.representative_sources[0] ?? emptySource();
  return {
    claimType: existing.claim_type,
    claimSummary: existing.claim_summary,
    rumoredBenefit: existing.rumored_benefit,
    signals: existing.signals,
    etaText: existing.eta_text,
    etaDate: existing.eta_date,
    confidence: existing.has_credible_source ? 1 : 0,
    source: { ...source, posted_at: existing.last_seen_at ?? source.posted_at },
  };
}

function sortedLeadClaims(existing: RumorRow | null, contributions: RumorContribution[]): LeadClaim[] {
  const claims = contributions.map(leadFromContribution);
  if (existing) claims.push(leadFromExisting(existing));
  return claims.sort(compareLeadClaims);
}

function etaForLead(lead: LeadClaim, claims: LeadClaim[]): { etaText: string | null; etaDate: string | null } {
  const etaSource = claims.find(
    (claim) =>
      claim.claimType === lead.claimType &&
      (cleanStr(claim.etaText) || cleanStr(claim.etaDate)),
  );
  return {
    etaText: etaSource ? cleanStr(etaSource.etaText) : null,
    etaDate: etaSource ? cleanStr(etaSource.etaDate) : null,
  };
}

/**
 * Merge this run's contributions for ONE cluster (model_slug, version_key) into
 * the existing accumulator row (or null for a fresh cluster). The strongest
 * lifecycle claim drives the human-readable current-state fields; delayed/return
 * win over launch/in_testing, and ETA only comes from that winning lifecycle.
 */
export function mergeCluster(
  existing: RumorRow | null,
  contributions: RumorContribution[],
  maxSources: number,
): RumorRow {
  const sorted = [...contributions].sort(
    (a, b) => ts(b.source.posted_at) - ts(a.source.posted_at),
  );
  const newest = sorted[0];
  const leadClaims = sortedLeadClaims(existing, contributions);
  const lead = leadClaims[0];
  const leadEta = etaForLead(lead, leadClaims);

  // Distinct sources this run, by url.
  const bySrc = new Map<string, SourceRef>();
  for (const c of contributions) if (!bySrc.has(c.source.url)) bySrc.set(c.source.url, withSourceQuality(c.source));
  const distinctNewSources = [...bySrc.values()];

  const newPlatforms = new Set(contributions.map((c) => c.source.platform));
  const etaTexts = new Set(
    [
      existing?.eta_text ?? null,
      ...contributions.map((c) => c.etaText),
    ].map((eta) => etaKey(eta)).filter(Boolean) as string[],
  );
  const etaDates = new Set(
    [
      existing?.eta_date ?? null,
      ...contributions.map((c) => cleanStr(c.etaDate)),
    ].filter(Boolean) as string[],
  );

  if (!existing) {
    return {
      model_slug: newest.modelSlug,
      version_key: newest.versionKey,
      version_label: newest.versionLabel,
      codename: newest.codename,
      claim_type: lead.claimType,
      claim_summary: lead.claimSummary,
      rumored_benefit: lead.rumoredBenefit ?? firstNonNull(sorted.map((c) => c.rumoredBenefit)),
      benefit_verified: false,
      signals: lead.signals ?? firstNonNull(sorted.map((c) => c.signals)),
      eta_text: leadEta.etaText,
      eta_date: leadEta.etaDate,
      eta_conflicting: etaTexts.size > 1 || etaDates.size > 1,
      mention_count: distinctNewSources.length,
      platforms: [...newPlatforms],
      representative_sources: mergeSources([], distinctNewSources, maxSources),
      has_credible_source: contributions.some((c) => isCredibleSource(c.source)),
      first_seen_at: minTs(contributions.map((c) => c.source.posted_at)),
      last_seen_at: maxTs(contributions.map((c) => c.source.posted_at)),
    };
  }

  return {
    ...existing,
    version_label: existing.version_label ?? newest.versionLabel,
    codename: existing.codename ?? newest.codename,
    claim_type: lead.claimType,
    claim_summary: lead.claimSummary,
    rumored_benefit: lead.rumoredBenefit ?? existing.rumored_benefit ?? firstNonNull(sorted.map((c) => c.rumoredBenefit)),
    signals: lead.signals ?? existing.signals ?? firstNonNull(sorted.map((c) => c.signals)),
    eta_text: leadEta.etaText,
    eta_date: leadEta.etaDate,
    eta_conflicting: existing.eta_conflicting || etaTexts.size > 1 || etaDates.size > 1,
    mention_count: existing.mention_count + distinctNewSources.length,
    platforms: [...new Set([...existing.platforms, ...newPlatforms])],
    representative_sources: mergeSources(existing.representative_sources, distinctNewSources, maxSources),
    has_credible_source: existing.has_credible_source || contributions.some((c) => isCredibleSource(c.source)),
    last_seen_at: maxTs([existing.last_seen_at, ...contributions.map((c) => c.source.posted_at)]),
  };
}

/** Group validated contributions by cluster key for the upsert loop. */
export function groupByCluster(contributions: RumorContribution[]): Map<string, RumorContribution[]> {
  const groups = new Map<string, RumorContribution[]>();
  for (const c of contributions) {
    const key = `${c.modelSlug}:${c.versionKey}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  return groups;
}

/** Pull the numeric status id out of an x.com/twitter.com /status/<id> URL. */
export function statusIdFromUrl(url: string | null | undefined): string | null {
  const m = /status\/(\d+)/.exec(url ?? "");
  return m ? m[1] : null;
}

const REFERENCED_X_STATUS_RE =
  /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/(?:(?:i\/web\/status)|(?:[^/\s?#]+\/status))\/(\d+)/gi;

/** Pull the first referenced X/Twitter status id out of repost text. */
export function referencedStatusIdFromText(
  text: string | null | undefined,
  ownUrl?: string | null,
): string | null {
  const ownId = statusIdFromUrl(ownUrl);
  const body = text ?? "";
  for (const match of body.matchAll(REFERENCED_X_STATUS_RE)) {
    const id = match[1];
    if (id && id !== ownId) return id;
  }
  return null;
}

/**
 * Within one cluster, drop a quote-tweet that quotes another tweet already in
 * the cluster — an echo is not independent corroboration (e.g. "Build with
 * Hasan" quoting "synthwavedd"). Keeps the quoted original. Quotes whose
 * original we didn't scrape are kept (we can't know they're echoes).
 */
export function collapseQuoteEchoes(group: RumorContribution[]): RumorContribution[] {
  const ownIds = new Set<string>();
  for (const c of group) {
    const id = statusIdFromUrl(c.source.url);
    if (id) ownIds.add(id);
  }
  return group.filter((c) => {
    const q = c.source.quotedStatusId;
    return !(q && ownIds.has(q));
  });
}
