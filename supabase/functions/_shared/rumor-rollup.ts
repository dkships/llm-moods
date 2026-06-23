// Pure (Deno-free) rollup/merge helpers for the upcoming-model rumors radar.
// Shared between the `aggregate-rumors` edge function and its vitest unit tests,
// so this file must NOT import anything Deno-specific.
//
// The accumulator model: `model_rumors` is keyed by (model_slug, version_key) and
// updated incrementally each run. `mention_count` counts DISTINCT source_url ever
// seen — and since a post is extracted exactly once (the `rumor_checked_at` gate),
// a url contributes to exactly one run, so we can safely add this run's distinct
// new urls without double-counting.

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

  // Anti-hallucination: a stated version token must be a substring of the post.
  if (versionLabel && !postText.toLowerCase().includes(versionLabel.toLowerCase())) {
    return null;
  }

  const versionKey = normalizeVersionKey(versionLabel, codename);
  if (!versionKey) return null;

  const claimType = (VALID_CLAIM_TYPES.has(raw.claim_type as RumorClaimType)
    ? (raw.claim_type as RumorClaimType)
    : "other");

  return {
    modelSlug: family,
    versionKey,
    versionLabel,
    codename,
    claimType,
    claimSummary: cleanStr(raw.claim_summary) ?? "Discussed as an upcoming release.",
    rumoredBenefit: cleanStr(raw.rumored_benefit),
    signals: cleanStr(raw.signals),
    etaText: cleanStr(raw.eta_text),
    etaDate: cleanStr(raw.eta_date),
    confidence: clampConfidence(raw.confidence),
    source,
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

function pickClaimType(types: RumorClaimType[]): RumorClaimType {
  for (const t of CLAIM_TYPE_PRECEDENCE) if (types.includes(t)) return t;
  return "other";
}

function mergeSources(
  existing: SourceRef[],
  incoming: SourceRef[],
  maxSources: number,
): SourceRef[] {
  const byUrl = new Map<string, SourceRef>();
  for (const s of [...existing, ...incoming]) if (s?.url) byUrl.set(s.url, s);
  return [...byUrl.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, maxSources);
}

/**
 * Merge this run's contributions for ONE cluster (model_slug, version_key) into
 * the existing accumulator row (or null for a fresh cluster). The newest
 * contribution by `posted_at` drives the human-readable "current state" fields;
 * `claim_type` uses precedence so delayed/return stay sticky.
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

  // Distinct sources this run, by url.
  const bySrc = new Map<string, SourceRef>();
  for (const c of contributions) if (!bySrc.has(c.source.url)) bySrc.set(c.source.url, c.source);
  const distinctNewSources = [...bySrc.values()];

  const newPlatforms = new Set(contributions.map((c) => c.source.platform));
  const etaTexts = new Set(contributions.map((c) => c.etaText).filter(Boolean) as string[]);

  if (!existing) {
    return {
      model_slug: newest.modelSlug,
      version_key: newest.versionKey,
      version_label: newest.versionLabel,
      codename: newest.codename,
      claim_type: pickClaimType(contributions.map((c) => c.claimType)),
      claim_summary: newest.claimSummary,
      rumored_benefit: firstNonNull(sorted.map((c) => c.rumoredBenefit)),
      benefit_verified: false,
      signals: firstNonNull(sorted.map((c) => c.signals)),
      eta_text: newest.etaText ?? firstNonNull(sorted.map((c) => c.etaText)),
      eta_date: newest.etaDate ?? firstNonNull(sorted.map((c) => c.etaDate)),
      eta_conflicting: etaTexts.size > 1,
      mention_count: distinctNewSources.length,
      platforms: [...newPlatforms],
      representative_sources: mergeSources([], distinctNewSources, maxSources),
      first_seen_at: minTs(contributions.map((c) => c.source.posted_at)),
      last_seen_at: maxTs(contributions.map((c) => c.source.posted_at)),
    };
  }

  const newestEta = newest.etaText;
  const etaChanged = Boolean(newestEta && existing.eta_text && newestEta !== existing.eta_text);
  const newerThanExisting = ts(newest.source.posted_at) >= ts(existing.last_seen_at);

  return {
    ...existing,
    version_label: existing.version_label ?? newest.versionLabel,
    codename: existing.codename ?? newest.codename,
    claim_type: pickClaimType([existing.claim_type, ...contributions.map((c) => c.claimType)]),
    claim_summary: newerThanExisting ? newest.claimSummary : existing.claim_summary,
    rumored_benefit: existing.rumored_benefit ?? firstNonNull(sorted.map((c) => c.rumoredBenefit)),
    signals: existing.signals ?? firstNonNull(sorted.map((c) => c.signals)),
    eta_text: newerThanExisting && newestEta ? newestEta : existing.eta_text,
    eta_date: newerThanExisting && newest.etaDate ? newest.etaDate : existing.eta_date,
    eta_conflicting: existing.eta_conflicting || etaChanged || etaTexts.size > 1,
    mention_count: existing.mention_count + distinctNewSources.length,
    platforms: [...new Set([...existing.platforms, ...newPlatforms])],
    representative_sources: mergeSources(existing.representative_sources, distinctNewSources, maxSources),
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
