// Pure (Deno-free) rollup/merge helpers for the upcoming-model rumors radar.
// Shared between the `aggregate-rumors` edge function and its vitest unit tests,
// so this file must NOT import anything Deno-specific.
//
// The canonicalization + frontier-filtering it leans on lives in the zero-import
// sibling `rumor-canon.ts` (also used by the frontend display merge).
//
// The accumulator model: `model_rumors` is keyed by (model_slug, version_key) and
// updated incrementally each run. `mention_count` counts independent origins:
// repeated posts by one account and quote echoes of one upstream post count once.
// Representative origin metadata is retained so later runs do not re-count it.

import {
  TRACKED_LEAKER_HANDLES,
  canonicalVersionKey,
  dedupeRumorSources,
  inferSourceQuality,
  isNonFrontierLabel,
  isReleasedVersion,
  isVettedRumorSource,
  sourceHandleFromUrl,
  sourceQualityRank,
  splitCompoundLabel,
  type RumorClaimMode,
  type RumorEvidenceKind,
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
  claim_mode?: string;
  evidence_kind?: string;
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
  /** Platform post id this source quotes, if any — used to collapse echoes. */
  quotedStatusId?: string | null;
  /** Display/source-quality context inferred from handle, domain, or source type. */
  source_quality?: SourceQuality | null;
  /** Whether the post reports/observes information or merely speculates. */
  claim_mode?: RumorClaimMode | null;
  /** Concrete basis for the claim, when the post supplies one. */
  evidence_kind?: RumorEvidenceKind | null;
  /** Extractor confidence that this post asserts genuine non-public information. */
  claim_confidence?: number | null;
}

// Tracked leaker handles (lowercased, no @). EPHEMERAL: refresh each model cycle
// alongside the codename `model_keywords` and rumor-canon alias catalog. The
// matching `from:<handle>` Twitter search terms live in scraper_config.
export const KNOWN_LEAKERS = TRACKED_LEAKER_HANDLES;

const VERIFIED_FOLLOWER_FLOOR = 10000;
const HIGH_ENGAGEMENT_FLOOR = 250;

/**
 * A source is "credible" if it is curated reporting/official evidence or a
 * concrete observed artifact. Verified/follower counts affect ordering only;
 * popularity never lets an untracked account open a one-source card.
 */
function hasCredibleAccount(s: SourceRef): boolean {
  return s.verified === true && (s.followers ?? 0) >= VERIFIED_FOLLOWER_FLOOR;
}

export function isCredibleSource(s: SourceRef): boolean {
  return isVettedRumorSource(s);
}

// Higher rank = more authoritative; used to order representative_sources so a
// tracked-leaker / verified tweet leads even when a Reddit post has more upvotes.
function credibilityRank(s: SourceRef): number {
  const qualityRank = sourceQualityRank(s) * 10;
  const evidenceRank =
    s.evidence_kind === "artifact"
      ? 38
      : s.evidence_kind === "official_hint"
        ? 34
        : s.evidence_kind === "prediction_market"
          ? 20
          : s.evidence_kind === "firsthand_access"
            ? 18
            : s.evidence_kind === "named_source"
              ? 12
              : 0;
  const accountRank = hasCredibleAccount(s) ? 15 : 0;
  const engagementRank = (s.score ?? 0) >= HIGH_ENGAGEMENT_FLOOR ? 10 : 0;
  return Math.max(qualityRank, evidenceRank, accountRank, engagementRank);
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
const VALID_CLAIM_MODES = new Set<RumorClaimMode>([
  "observed_signal",
  "reported_information",
  "inference",
  "speculation",
]);
const VALID_EVIDENCE_KINDS = new Set<RumorEvidenceKind>([
  "artifact",
  "firsthand_access",
  "named_source",
  "official_hint",
  "prediction_market",
  "none",
]);
const SPECULATIVE_CLAIM_RE = [
  /^\s*if\b/i,
  /\bif i were\b/i,
  /\bwould not be surprised if\b/i,
  /\bi (?:think|guess|bet|hope|wish|expect)\b/i,
  /\b(?:needs?|would need|has to)\b[^.!?\n]{0,120}\b(?:hit|be|make|release|launch|drop)\b/i,
  /\b(?:should|could|might|would)\b[^.!?\n]{0,80}\b(?:make room|be interesting|be better|contend|hit)\b/i,
];

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

function claimMode(value: unknown): RumorClaimMode | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_CLAIM_MODES.has(normalized as RumorClaimMode)
    ? (normalized as RumorClaimMode)
    : null;
}

function evidenceKind(value: unknown): RumorEvidenceKind {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_EVIDENCE_KINDS.has(normalized as RumorEvidenceKind)
    ? (normalized as RumorEvidenceKind)
    : "none";
}

function claimSpecificText(
  postText: string,
  label: string | null,
  codename: string | null,
): string {
  const identities = [label, codename]
    .flatMap((value) => splitCompoundLabel(value))
    .map(squash)
    .filter((value) => value.length >= 2);
  if (identities.length === 0) return postText;
  const chunks = postText
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const matches = chunks.filter((part) => {
    const normalized = squash(part);
    return identities.some((identity) => normalized.includes(identity));
  });
  return matches.length > 0 ? matches.join(" ") : postText;
}

function isLegacySpeculation(
  source: SourceRef,
  postText: string,
  label: string | null,
  codename: string | null,
): boolean {
  if (isCredibleSource(source)) return false;
  const scoped = claimSpecificText(postText, label, codename);
  return SPECULATIVE_CLAIM_RE.some((pattern) => pattern.test(scoped));
}

function withSourceQuality<T extends SourceRef>(source: T): T {
  const recoveredHandle = source.handle?.trim() || sourceHandleFromUrl(source.url);
  return {
    ...source,
    handle: recoveredHandle,
    source_quality: inferSourceQuality(source),
  } as T;
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
  if (!raw || raw.is_rumor !== true) return null;
  if (raw.is_unreleased !== true) return null;

  const family = String(raw.target_family ?? "").toLowerCase() as TargetFamily;
  if (!VALID_FAMILIES.has(family)) return null;

  const versionLabel = cleanStr(raw.version_label);
  const codename = cleanStr(raw.codename);
  const mode = claimMode(raw.claim_mode);
  const evidence = evidenceKind(raw.evidence_kind);
  const confidence = clampConfidence(raw.confidence);

  // The extractor now labels sentiment, wishes, conditional scenarios, and
  // jokes explicitly. The strict text fallback cleans up old/malformed model
  // output without rejecting hedged reports from vetted sources.
  if (mode === "speculation") return null;
  if (!mode && isLegacySpeculation(source, postText, versionLabel, codename)) return null;
  if (mode === "inference" && evidence === "none") return null;
  if (raw.confidence != null && confidence < 0.55) return null;

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
    confidence,
    source: withSourceQuality({
      ...source,
      claim_mode: mode,
      evidence_kind: evidence,
      claim_confidence: confidence,
    }),
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

const GEMINI_35_PRO_RE = /\b(?:gemini\s*)?3[.,]\s*5\s*pro\b/i;
const DELAY_RE = /\b(?:delays?|delayed|pushed back|slipped|postponed|stalled|no longer|give us until)\b/i;
const TESTING_RE = /\b(?:in testing|early access|\bEAP\b|enterprise partners?|partner testing|testing ahead of|canary|spotted|api|arena|model[-\s]?(?:string|id)|codename)\b/i;
const IMMINENT_RE = /\b(?:imminent|eta|next week|this week|any day now|coming soon|dropping|drops? (?:next|this)|rolling out|rolls? out|scheduled|wider launch)\b/i;

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
 * can miss one obvious bullet. Kept intentionally narrow: the current backstop
 * covers the observed Gemini 3.5 Pro variant.
 */
export function recoverDeterministicClaims(source: SourceRef, postText: string): RawClaim[] {
  if (!backstopEligible(source)) return [];
  const text = (postText ?? "").trim();
  if (!compactWhitespace(text)) return [];

  const claims: RawClaim[] = [];

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
        claim_mode: "reported_information",
        evidence_kind: "named_source",
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
  const ranked = [...existing, ...incoming]
    .filter((source): source is SourceRef => Boolean(source?.url))
    .map(withSourceQuality)
    .sort(
      (a, b) =>
        credibilityRank(b) - credibilityRank(a) ||
        ts(b.posted_at) - ts(a.posted_at) ||
        (b.score ?? 0) - (a.score ?? 0),
    );
  return dedupeRumorSources(ranked).slice(0, maxSources);
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
  const sourceDelta = credibilityRank(b.source ?? emptySource()) - credibilityRank(a.source ?? emptySource());
  if (sourceDelta !== 0) return sourceDelta;
  const claimDelta = claimTypeRank(b.claimType) - claimTypeRank(a.claimType);
  if (claimDelta !== 0) return claimDelta;
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

  // Distinct corroborating origins this run. Repeated posts by one account and
  // multiple quote echoes of the same upstream post count once.
  const distinctNewSources = mergeSources(
    [],
    contributions.map((contribution) => contribution.source),
    contributions.length,
  );

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

  const combinedKnownSources = mergeSources(
    existing.representative_sources,
    distinctNewSources,
    existing.representative_sources.length + distinctNewSources.length,
  );
  const mentionCount = existing.representative_sources.length > 0
    ? Math.max(combinedKnownSources.length, existing.platforms.length, newPlatforms.size)
    : existing.mention_count + distinctNewSources.length;

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
    mention_count: mentionCount,
    platforms: [...new Set([...existing.platforms, ...newPlatforms])],
    representative_sources: mergeSources(existing.representative_sources, distinctNewSources, maxSources),
    has_credible_source:
      existing.representative_sources.some(isCredibleSource) ||
      contributions.some((c) => isCredibleSource(c.source)),
    last_seen_at: maxTs([existing.last_seen_at, ...contributions.map((c) => c.source.posted_at)]),
  };
}

export interface RumorIdentity {
  model_slug: string;
  version_key: string;
  version_label: string | null;
  codename: string | null;
}

interface IdentityNode {
  family: string;
  versionKey: string;
  versionLabel: string | null;
  codename: string | null;
  contributionIndex: number | null;
}

function nodeIdentityTokens(node: IdentityNode): string[] {
  const tokens = new Set<string>([node.versionKey]);
  const canon = canonicalVersionKey(node.family, node.versionLabel, node.codename);
  if (canon.key) tokens.add(canon.key);
  const label = squash(node.versionLabel);
  if (label.length >= 2) tokens.add(label);
  for (const part of splitCompoundLabel(node.codename)) {
    const raw = squash(part);
    if (raw.length >= 2) tokens.add(raw);
    const codenameKey = canonicalVersionKey(node.family, null, part).key;
    if (codenameKey) tokens.add(codenameKey);
  }
  return [...tokens];
}

function nodeIdentityScore(node: IdentityNode): number {
  return (node.versionLabel ? 20 : 0) + (node.codename ? 10 : 0);
}

/**
 * Group validated contributions by product identity. Existing accumulator rows
 * participate as bridges, so once one claim links "Opus 5" to "Honeycomb", a
 * later codename-only post writes to the Opus cluster without a manual alias.
 */
export function groupByCluster(
  contributions: RumorContribution[],
  existingIdentities: RumorIdentity[] = [],
): Map<string, RumorContribution[]> {
  const nodes: IdentityNode[] = [
    ...existingIdentities.map((row) => ({
      family: row.model_slug.toLowerCase(),
      versionKey: row.version_key,
      versionLabel: row.version_label,
      codename: row.codename,
      contributionIndex: null,
    })),
    ...contributions.map((contribution, contributionIndex) => ({
      family: contribution.modelSlug,
      versionKey: contribution.versionKey,
      versionLabel: contribution.versionLabel,
      codename: contribution.codename,
      contributionIndex,
    })),
  ];
  const parent = nodes.map((_node, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const tokenOwner = new Map<string, number>();
  nodes.forEach((node, index) => {
    for (const token of nodeIdentityTokens(node)) {
      const scoped = `${node.family}:${token}`;
      const owner = tokenOwner.get(scoped);
      if (owner == null) tokenOwner.set(scoped, index);
      else union(index, owner);
    }
  });

  const nodesByRoot = new Map<number, IdentityNode[]>();
  nodes.forEach((node, index) => {
    const root = find(index);
    const component = nodesByRoot.get(root) ?? [];
    component.push(node);
    nodesByRoot.set(root, component);
  });
  const anchorByRoot = new Map<number, IdentityNode>();
  for (const [root, component] of nodesByRoot) {
    anchorByRoot.set(
      root,
      [...component].sort(
        (a, b) =>
          nodeIdentityScore(b) - nodeIdentityScore(a) ||
          a.versionKey.length - b.versionKey.length,
      )[0],
    );
  }

  const groups = new Map<string, RumorContribution[]>();
  nodes.forEach((node, nodeIndex) => {
    if (node.contributionIndex == null) return;
    const anchor = anchorByRoot.get(find(nodeIndex)) ?? node;
    const original = contributions[node.contributionIndex];
    const contribution: RumorContribution = {
      ...original,
      versionKey: anchor.versionKey,
      versionLabel: anchor.versionLabel ?? original.versionLabel,
      codename: original.codename ?? anchor.codename,
    };
    const key = `${contribution.modelSlug}:${contribution.versionKey}`;
    const group = groups.get(key) ?? [];
    group.push(contribution);
    groups.set(key, group);
  });
  return groups;
}

/** Pull the platform post id out of an X status or Bluesky post URL. */
export function statusIdFromUrl(url: string | null | undefined): string | null {
  const raw = url ?? "";
  const x = /(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i.exec(raw);
  if (x) return x[1];
  const bluesky = /bsky\.app\/profile\/[^/]+\/post\/([^/?#]+)/i.exec(raw);
  return bluesky ? bluesky[1] : null;
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
 * Within one cluster, drop an X/Bluesky quote that references another post
 * already in the cluster. Keeps the quoted original. Quotes whose original we
 * did not scrape are deduped later by shared quotedStatusId.
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
