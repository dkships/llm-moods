// Canonicalization + frontier-filtering for the upcoming-model rumors radar.
// Deno-free and ZERO imports, so it bundles cleanly in BOTH the edge runtime
// (write-time, via `buildContribution` in rumor-rollup.ts) and the Vite
// frontend (display-time, via `useRumors`). Pure logic — unit-tested in
// `src/test/rumors.test.ts`.
//
// EPHEMERAL DATA: `FAMILY_ALIASES` and `COMPETITOR_DENY` are refreshed each
// model cycle alongside RELEASED_SET (aggregate-rumors), KNOWN_LEAKERS
// (rumor-rollup), and the codename `model_keywords` rows. A stale alias map
// silently stops merging next cycle's codenames — keep them in lockstep.

export type TrackedFamily = "claude" | "chatgpt" | "gemini" | "grok";

export const TRACKED_FAMILIES: ReadonlySet<string> = new Set([
  "claude",
  "chatgpt",
  "gemini",
  "grok",
]);

/** A canonical upcoming-version identity and the spellings that map to it. */
interface AliasEntry {
  key: string; // canonical version_key (already squashed)
  label: string | null; // canonical human label
  codename: string | null; // canonical codename
  aliases: string[]; // squashed spellings that resolve here
}

// Known upcoming versions whose codenames/labels are aliases of one model. The
// dominant live case: Claude's next-gen is discussed as Fable, Mythos, Fable 5,
// Mythos 5, and the compound "Mythos/Fable 5" — all one model. Add new entries
// (e.g. Gemini's "Orionmist") as they leak; leave a family empty when its
// versions are plain version numbers that `canonicalVersionKey` handles already.
const FAMILY_ALIASES: Record<TrackedFamily, AliasEntry[]> = {
  claude: [
    {
      key: "fable5",
      label: "Fable 5",
      codename: "Mythos",
      aliases: ["fable", "mythos", "fable5", "mythos5"],
    },
  ],
  chatgpt: [
    {
      key: "bidi",
      label: "GPT Bidi 1",
      codename: "Bidi",
      aliases: ["bidi", "gptbidi", "gptbidi1"],
    },
  ],
  gemini: [],
  grok: [],
};

// Non-frontier model/company names. A claim whose label or codename matches one
// is dropped — it isn't a Claude/ChatGPT/Gemini/Grok version, regardless of which
// family the extractor attributed it to. (Gemma is intentionally absent: it's
// Google but not Gemini, so it's filtered by family-consistency, not as a rival.)
const COMPETITOR_DENY: string[] = [
  "deepseek",
  "qwen",
  "qwq",
  "llama",
  "mistral",
  "mixtral",
  "kimi",
  "glm",
  "nova",
  "reka",
  "jamba",
  "dbrx",
  "falcon",
  "ernie",
  "hunyuan",
  "minimax",
  "command",
  "commandr",
  "yi",
  "phi",
];

// Short deny tokens would false-positive as substrings, so match them only as a
// whole squashed string; longer ones match as substrings ("Qwen3" → "qwen3").
const DENY_SUBSTR = COMPETITOR_DENY.filter((d) => d.length >= 4);
const DENY_EXACT = COMPETITOR_DENY.filter((d) => d.length < 4);

// Tokens that make a stated version_label "look like" each family. Tested against
// the squashed label, so "GPT-5.6" → "gpt56" still matches /gpt/.
const FAMILY_LABEL_RE: Record<TrackedFamily, RegExp> = {
  claude: /claude|opus|sonnet|haiku|fable|mythos/,
  chatgpt: /gpt|chatgpt|o[1-9]/,
  gemini: /gemini|flash|pro|ultra|nano/,
  grok: /grok/,
};

// A bare version like "5", "5.6", "v5" is family-consistent for any family.
const BARE_VERSION_RE = /^v?\d+(\.\d+)?$/;

function cleanStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function tsNum(v: string | null | undefined): number {
  if (!v) return 0;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : 0;
}

function etaKey(v: string | null | undefined): string | null {
  const q = squash(v);
  return q.length > 0 ? q : null;
}

/** Lowercase and strip every non-alphanumeric. Matches normalizeVersionKey's core. */
export function squash(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Split a compound label/codename into its component versions, distributing a
 * trailing version number across bare parts. "Mythos/Fable 5" → ["Mythos 5",
 * "Fable 5"]; "Sonnet 5 or Opus 5" → ["Sonnet 5", "Opus 5"]; "GPT-5.6" →
 * ["GPT-5.6"] (no separator). Returns [] for empty input.
 */
export function splitCompoundLabel(label: string | null | undefined): string[] {
  const raw = (label ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/\s*(?:\/|\bor\b|\baka\b|,|&)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [raw];
  const trailing = parts[parts.length - 1].match(/\s(\d+(?:\.\d+)?)$/);
  if (trailing) {
    const num = trailing[1];
    return parts.map((p) => (/\d/.test(p) ? p : `${p} ${num}`));
  }
  return parts;
}

/**
 * Resolve a (family, label, codename) to a canonical version identity. Splits
 * compound labels/codenames and matches each component against the family's
 * alias map; the first hit wins. Falls back to the squashed label/codename
 * (preserving novel codenames) so the radar still surfaces never-seen leaks.
 */
export function canonicalVersionKey(
  family: string | null | undefined,
  label: string | null | undefined,
  codename: string | null | undefined,
): { key: string | null; label: string | null; codename: string | null } {
  const fam = (family ?? "").toLowerCase();
  const entries = FAMILY_ALIASES[fam as TrackedFamily] ?? [];
  const candidates = [...splitCompoundLabel(label), ...splitCompoundLabel(codename)];
  for (const cand of candidates) {
    const q = squash(cand);
    if (q.length < 2) continue;
    for (const e of entries) {
      if (e.aliases.includes(q)) {
        return { key: e.key, label: e.label, codename: e.codename };
      }
    }
  }
  const fallback = squash(label || codename || "");
  return {
    key: fallback.length >= 2 ? fallback : null,
    label: cleanStr(label),
    codename: cleanStr(codename),
  };
}

function hitsDeny(s: string | null | undefined): boolean {
  const q = squash(s);
  if (!q) return false;
  if (DENY_EXACT.includes(q)) return true;
  return DENY_SUBSTR.some((d) => q.includes(d));
}

/**
 * Does a stated version_label look like it belongs to `family`? Accepts a bare
 * version number, a family product keyword, or a known alias codename for that
 * family. Used only when a version_label is present.
 */
export function isFamilyConsistentLabel(family: string, label: string): boolean {
  const trimmed = label.trim().toLowerCase();
  if (!trimmed) return true;
  if (BARE_VERSION_RE.test(trimmed)) return true;
  const q = squash(label);
  const re = FAMILY_LABEL_RE[family as TrackedFamily];
  if (re && re.test(q)) return true;
  const aliasTokens = (FAMILY_ALIASES[family as TrackedFamily] ?? []).flatMap((e) => e.aliases);
  return aliasTokens.some((a) => q.includes(a));
}

/**
 * Should this claim be dropped as not-actually-a-tracked-frontier-model?
 * - A competitor name in the label OR codename → drop.
 * - A stated version_label that isn't family-consistent → drop (catches "Badoo"
 *   dressed as a version, or a rival coerced into one of the four).
 * - A codename-only claim (no label) stays — the credibility / ≥2-mention gate is
 *   its backstop. This is the deliberate "don't blind the radar to new codenames"
 *   choice.
 */
export function isNonFrontierLabel(
  family: string,
  label: string | null | undefined,
  codename: string | null | undefined,
): boolean {
  if (hitsDeny(label) || hitsDeny(codename)) return true;
  const l = cleanStr(label);
  if (l && !isFamilyConsistentLabel(family, l)) return true;
  return false;
}

// Highest precedence first (mirrors CLAIM_TYPE_PRECEDENCE in rumor-rollup.ts;
// inlined to keep this a zero-import leaf). delayed/return are sticky lifecycle
// states that win over an older launch/in_testing.
const CLAIM_TYPE_PRECEDENCE = ["delayed", "return", "imminent", "in_testing", "launch", "other"];

/** Minimal source shape the merge needs; richer fields pass through untouched. */
interface MergeSource {
  url?: string | null;
  platform?: string | null;
  handle?: string | null;
  verified?: boolean | null;
  score?: number | null;
}

/** Minimal row shape both PublicRumorRow and the backend RumorRow satisfy. */
export interface MergeableRumor {
  model_slug: string;
  version_label: string | null;
  codename: string | null;
  claim_type: string;
  claim_summary: string;
  mention_count: number;
  platform_count: number;
  representative_sources: MergeSource[] | null;
  last_seen_at: string | null;
}

function mergeGroup<T extends MergeableRumor>(group: T[]): T {
  const sorted = [...group].sort((a, b) => tsNum(b.last_seen_at) - tsNum(a.last_seen_at));
  const newest = sorted[0];
  const canon = canonicalVersionKey(newest.model_slug, newest.version_label, newest.codename);

  // Union representative sources by url (keeps the full original objects), then
  // surface credible / handled sources first so the card's lead stays sensible.
  const byUrl = new Map<string, MergeSource>();
  for (const r of group) {
    for (const s of r.representative_sources ?? []) {
      if (s && s.url) byUrl.set(s.url, s);
    }
  }
  const reps = [...byUrl.values()].sort(
    (a, b) =>
      Number(Boolean(b.verified)) - Number(Boolean(a.verified)) ||
      Number(Boolean(b.handle)) - Number(Boolean(a.handle)) ||
      (b.score ?? 0) - (a.score ?? 0),
  );

  // mention_count = |union of visible urls| + Σ (each row's unseen tail). Exact
  // when rows are disjoint; subtracts a shared influential url once.
  let hidden = 0;
  for (const r of group) {
    const repUrls = new Set((r.representative_sources ?? []).map((s) => s?.url).filter(Boolean));
    hidden += Math.max(0, (r.mention_count ?? 0) - repUrls.size);
  }
  const mentionCount = byUrl.size + hidden;

  const repPlatforms = new Set(reps.map((s) => s.platform).filter(Boolean));
  const platformCount = Math.max(...group.map((r) => r.platform_count ?? 0), repPlatforms.size);

  const types = group.map((r) => r.claim_type);
  let claimType = "other";
  for (const t of CLAIM_TYPE_PRECEDENCE) {
    if (types.includes(t)) {
      claimType = t;
      break;
    }
  }

  const etaTexts = new Set(
    group
      .map((r) => etaKey((r as { eta_text?: string | null }).eta_text))
      .filter(Boolean) as string[],
  );
  const etaDates = new Set(
    group
      .map((r) => cleanStr((r as { eta_date?: string | null }).eta_date))
      .filter(Boolean) as string[],
  );
  const etaSource = sorted.find(
    (r) =>
      cleanStr((r as { eta_text?: string | null }).eta_text) ||
      cleanStr((r as { eta_date?: string | null }).eta_date),
  );

  const merged = { ...newest } as T;
  merged.version_label = canon.label ?? newest.version_label;
  merged.codename = canon.codename ?? newest.codename;
  merged.claim_type = claimType;
  merged.mention_count = mentionCount;
  merged.platform_count = platformCount;
  merged.representative_sources = reps as T["representative_sources"];
  merged.last_seen_at = newest.last_seen_at;

  // Passthrough fields not in MergeableRumor (present on PublicRumorRow / RumorRow).
  const m = merged as unknown as Record<string, unknown>;
  m.has_credible_source = group.some((r) => (r as { has_credible_source?: boolean }).has_credible_source);
  if (etaSource) {
    m.eta_text = cleanStr((etaSource as { eta_text?: string | null }).eta_text);
    m.eta_date = cleanStr((etaSource as { eta_date?: string | null }).eta_date);
  }
  m.eta_conflicting =
    group.some((r) => (r as { eta_conflicting?: boolean }).eta_conflicting) ||
    etaTexts.size > 1 ||
    etaDates.size > 1;
  m.first_seen_at =
    group
      .map((r) => (r as { first_seen_at?: string | null }).first_seen_at)
      .filter(Boolean)
      .sort((a, b) => tsNum(a) - tsNum(b))[0] ?? (newest as { first_seen_at?: string | null }).first_seen_at;
  return merged;
}

/**
 * Filter to tracked-frontier rumors and collapse alias-duplicate rows into one
 * card each. Drops untracked families and non-frontier labels, groups by
 * (model_slug, canonical version key), and merges each group's counts, sources,
 * and display fields. Singletons pass through with canonical label/codename
 * applied so e.g. a lone "Mythos" card still reads "Fable 5 · Mythos".
 */
export function mergeRumorRows<T extends MergeableRumor>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const r of rows ?? []) {
    const slug = (r.model_slug ?? "").toLowerCase();
    if (!TRACKED_FAMILIES.has(slug)) continue;
    if (isNonFrontierLabel(slug, r.version_label, r.codename)) continue;
    const { key } = canonicalVersionKey(slug, r.version_label, r.codename);
    const groupKey = `${slug}:${key ?? squash(r.version_label || r.codename || "")}`;
    const arr = groups.get(groupKey) ?? [];
    arr.push(r);
    groups.set(groupKey, arr);
  }
  const out: T[] = [];
  for (const group of groups.values()) out.push(mergeGroup(group));
  return out;
}
