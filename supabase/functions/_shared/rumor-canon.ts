// Canonicalization + frontier-filtering for the upcoming-model rumors radar.
// Deno-free and ZERO imports, so it bundles cleanly in BOTH the edge runtime
// (write-time, via `buildContribution` in rumor-rollup.ts) and the Vite
// frontend (display-time, via `useRumors`). Pure logic — unit-tested in
// `src/test/rumors.test.ts`.
//
// EPHEMERAL DATA: `FAMILY_ALIASES`, `COMPETITOR_DENY`, and
// `TRACKED_LEAKER_HANDLES` are refreshed each model cycle alongside the codename
// `model_keywords` rows. `releasedSetPrompt()` derives the extractor's released
// list from this catalog so the write path and display filter cannot drift.

export type TrackedFamily = "claude" | "chatgpt" | "gemini" | "grok";

export const TRACKED_FAMILIES: ReadonlySet<string> = new Set([
  "claude",
  "chatgpt",
  "gemini",
  "grok",
]);

export type SourceQuality =
  | "tracked_leaker"
  | "press_scoop"
  | "artifact_leak"
  | "prediction_market"
  | "press_echo"
  | "official"
  | "unknown";

interface SourceQualityInput {
  url?: string | null;
  platform?: string | null;
  handle?: string | null;
  quotedStatusId?: string | null;
  source_quality?: string | null;
}

// Tracked leaker handles (lowercased, no @). Mirrors scraper_config X search
// terms and the old KNOWN_LEAKERS export in rumor-rollup.ts.
export const TRACKED_LEAKER_HANDLES: ReadonlySet<string> = new Set([
  "synthwavedd",
  "btibor91",
  "apples_jimmy",
  "testingcatalog",
  "scaling01",
]);

const PRESS_SCOOP_HANDLES: ReadonlySet<string> = new Set([
  "axios",
  "semafor",
  "theinformation",
  "fortunemagazine",
]);

const VALID_SOURCE_QUALITIES: ReadonlySet<string> = new Set([
  "tracked_leaker",
  "press_scoop",
  "artifact_leak",
  "prediction_market",
  "press_echo",
  "official",
  "unknown",
]);

const OFFICIAL_DOMAINS = [
  "openai.com",
  "anthropic.com",
  "google.com",
  "google.dev",
  "googleblog.com",
  "deepmind.google",
  "x.ai",
];

const PREDICTION_MARKET_DOMAINS = [
  "polymarket.com",
  "kalshi.com",
  "manifold.markets",
];

const ARTIFACT_LEAK_DOMAINS = [
  "testingcatalog.com",
  "github.com",
  "huggingface.co",
  "lmarena.ai",
];

const PRESS_SCOOP_DOMAINS = [
  "axios.com",
  "semafor.com",
  "theinformation.com",
  "fortune.com",
];

const PRESS_ECHO_DOMAINS = [
  "androidauthority.com",
  "digg.com",
  "theverge.com",
  "techcrunch.com",
  "venturebeat.com",
  "windowscentral.com",
  "tomsguide.com",
  "9to5google.com",
  "neowin.net",
];

const SOURCE_QUALITY_LABELS: Record<SourceQuality, string> = {
  tracked_leaker: "tracked leaker",
  press_scoop: "reported scoop",
  artifact_leak: "artifact leak",
  prediction_market: "prediction market signal",
  press_echo: "press echo",
  official: "official status check",
  unknown: "community signal",
};

const SOURCE_QUALITY_RANK: Record<SourceQuality, number> = {
  official: 5,
  tracked_leaker: 4,
  press_scoop: 3,
  artifact_leak: 3,
  prediction_market: 2,
  press_echo: 1,
  unknown: 0,
};

export function normalizeSourceHandle(handle: string | null | undefined): string {
  return (handle ?? "").trim().replace(/^@/, "").toLowerCase();
}

function normalizeSourceQuality(value: string | null | undefined): SourceQuality | null {
  const q = (value ?? "").trim().toLowerCase();
  return VALID_SOURCE_QUALITIES.has(q) ? (q as SourceQuality) : null;
}

function hostnameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostMatches(host: string | null, domains: string[]): boolean {
  if (!host) return false;
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function inferSourceQuality(source: SourceQualityInput): SourceQuality {
  const explicit = normalizeSourceQuality(source.source_quality);
  if (explicit && explicit !== "unknown") return explicit;

  const handle = normalizeSourceHandle(source.handle);
  if (TRACKED_LEAKER_HANDLES.has(handle)) return "tracked_leaker";
  if (PRESS_SCOOP_HANDLES.has(handle)) return "press_scoop";

  const platform = (source.platform ?? "").toLowerCase();
  const host = hostnameFromUrl(source.url);
  if (hostMatches(host, OFFICIAL_DOMAINS) || platform === "official") return "official";
  if (hostMatches(host, PRESS_SCOOP_DOMAINS)) return "press_scoop";
  if (hostMatches(host, ARTIFACT_LEAK_DOMAINS) || platform === "github") return "artifact_leak";
  if (hostMatches(host, PREDICTION_MARKET_DOMAINS) || platform === "prediction_market") {
    return "prediction_market";
  }
  if (source.quotedStatusId || hostMatches(host, PRESS_ECHO_DOMAINS) || platform === "press") {
    return "press_echo";
  }

  return explicit ?? "unknown";
}

export function sourceQualityRank(source: SourceQuality | SourceQualityInput | null | undefined): number {
  if (!source) return 0;
  const quality = typeof source === "string" ? normalizeSourceQuality(source) ?? "unknown" : inferSourceQuality(source);
  return SOURCE_QUALITY_RANK[quality];
}

export function sourceQualityLabel(source: SourceQuality | SourceQualityInput | null | undefined): string {
  if (!source) return SOURCE_QUALITY_LABELS.unknown;
  const quality = typeof source === "string" ? normalizeSourceQuality(source) ?? "unknown" : inferSourceQuality(source);
  return SOURCE_QUALITY_LABELS[quality];
}

/** A canonical upcoming-version identity and the spellings that map to it. */
interface AliasEntry {
  key: string; // canonical version_key (already squashed)
  label: string | null; // canonical human label
  codename: string | null; // canonical codename
  aliases: string[]; // squashed spellings that resolve here
  released?: boolean; // true once shipped → retired from the radar (see isReleasedVersion)
  releasePrompt?: string; // released-set wording; omit on superseded snapshots
  releaseAliases?: string[]; // distinctive names safe to scan in GA announcement text
}

// Known upcoming versions whose codenames/labels are aliases of one model. The
// dominant live case: Claude's next-gen is discussed as Fable, Mythos, Fable 5,
// Mythos 5, and the compound "Mythos/Fable 5" — all one model. Add new entries
// (e.g. Gemini's "Orionmist") as they leak; leave a family empty when its
// versions are plain version numbers that `canonicalVersionKey` handles already.
// Set `released: true` once a version ships — `isReleasedVersion` derives its
// retire-list from these, so flipping the flag drops it from the radar.
const FAMILY_ALIASES: Record<TrackedFamily, AliasEntry[]> = {
  claude: [
    {
      key: "opus47",
      label: "Opus 4.7",
      codename: null,
      aliases: ["opus47", "claudeopus47"],
      released: true,
    },
    {
      key: "opus48",
      label: "Opus 4.8",
      codename: null,
      aliases: ["opus48", "claudeopus48"],
      released: true,
      releasePrompt: "Opus 4.8 and earlier",
    },
    {
      key: "sonnet46",
      label: "Sonnet 4.6",
      codename: null,
      aliases: ["sonnet46", "claudesonnet46"],
      released: true,
    },
    {
      key: "fable5",
      label: "Fable 5",
      codename: "Mythos",
      aliases: ["fable", "mythos", "fable5", "mythos5"],
      released: true,
      releasePrompt: "Fable 5 / Mythos 5",
      releaseAliases: ["fable", "mythos", "fable5", "mythos5"],
    },
    {
      key: "sonnet5",
      label: "Sonnet 5",
      codename: null,
      // "sonic5" is a common mis-spelling of the shipped Sonnet 5; fold it in so
      // it canonically collapses here rather than surfacing as a stray card.
      aliases: ["sonnet5", "sonic5"],
      released: true,
      releasePrompt: "Sonnet 5 and earlier",
    },
    {
      key: "haiku45",
      label: "Haiku 4.5",
      codename: null,
      aliases: ["haiku45", "claudehaiku45"],
      released: true,
      releasePrompt: "Haiku 4.5 and earlier",
    },
  ],
  chatgpt: [
    {
      key: "gpt56",
      label: "GPT-5.6",
      codename: null,
      aliases: ["gpt56", "gpt56sol", "gpt56terra", "gpt56luna"],
      released: true,
      releasePrompt: "GPT-5.6 (Sol, Terra, Luna) and earlier",
    },
    {
      key: "bidi",
      label: "GPT Bidi 1",
      codename: "Bidi",
      aliases: ["bidi", "gptbidi", "gptbidi1", "gptlive", "gptlive1"],
      released: true,
      releasePrompt: "GPT-Live 1 / Bidi",
      releaseAliases: ["bidi", "gptbidi", "gptbidi1", "gptlive", "gptlive1"],
    },
  ],
  gemini: [
    {
      key: "gemini3pro",
      label: "Gemini 3 Pro",
      codename: null,
      aliases: ["gemini3pro"],
      released: true,
      releasePrompt: "Gemini 3 Pro",
    },
    {
      key: "gemini3flash",
      label: "Gemini 3 Flash",
      codename: null,
      aliases: ["gemini3flash"],
      released: true,
      releasePrompt: "Gemini 3 Flash",
    },
    {
      key: "gemini35flash",
      label: "Gemini 3.5 Flash",
      codename: null,
      aliases: ["gemini35flash"],
      released: true,
      releasePrompt: "Gemini 3.5 Flash",
    },
    {
      key: "gemini35pro",
      label: "Gemini 3.5 Pro",
      codename: null,
      aliases: ["35pro", "gemini35pro"],
    },
  ],
  grok: [
    {
      key: "grok45",
      label: "Grok 4.5",
      codename: null,
      aliases: ["grok45"],
      released: true,
      releasePrompt: "Grok 4.5 and earlier",
    },
  ],
};

const FAMILY_PROMPT_LABELS: Record<TrackedFamily, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT/OpenAI",
  gemini: "Gemini",
  grok: "Grok",
};

/** Build the extractor's released-set prompt from the display/write-time catalog. */
export function releasedSetPrompt(): string {
  const families = Object.entries(FAMILY_ALIASES).map(([family, entries]) => {
    const releases = entries
      .filter((entry) => entry.released && entry.releasePrompt)
      .map((entry) => entry.releasePrompt);
    return `${FAMILY_PROMPT_LABELS[family as TrackedFamily]}: ${releases.join(", ")}.`;
  });
  return `${families.join(" ")} Anything newer, or an unrecognized codename, is UNRELEASED.`;
}

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
 * alias map; the first hit wins. Numbered ChatGPT generations also collapse a
 * repeated codename suffix ("GPT-6 Sol" + codename "Sol") into the generation
 * key. Falls back to the squashed label/codename (preserving novel codenames)
 * so the radar still surfaces never-seen leaks.
 */
function canonicalChatGptGeneration(
  label: string | null | undefined,
  codename: string | null | undefined,
): { key: string; label: string; codename: string | null } | null {
  const rawLabel = cleanStr(label);
  if (!rawLabel) return null;

  // Accept "GPT-6", "ChatGPT 6", and a family-scoped bare "6". A suffix is
  // folded into the generation only when the extractor also identified it as a
  // codename. This catches the observed "GPT-5.6 Sol" / codename "Sol" split
  // without conflating real product variants such as GPT-6 Mini.
  const match = rawLabel.match(
    /^(?:(?:chatgpt|gpt)[\s-]*)?(?:v\s*)?(\d+(?:[.,]\d+)*)(.*)$/i,
  );
  if (!match) return null;

  const rawSuffix = cleanStr(
    (match[2] ?? "").replace(/^[\s\-\u2013\u2014:·/|,()]+/, ""),
  );
  const cleanCodename = cleanStr(codename);
  if (rawSuffix) {
    if (!cleanCodename) return null;
    const suffixParts = splitCompoundLabel(rawSuffix).map(squash).filter(Boolean);
    const codenameParts = new Set(splitCompoundLabel(cleanCodename).map(squash).filter(Boolean));
    if (suffixParts.length === 0 || suffixParts.some((part) => !codenameParts.has(part))) {
      return null;
    }
  }

  const version = match[1].replace(/,/g, ".");
  return {
    key: `gpt${version.replace(/[^0-9]/g, "")}`,
    label: `GPT-${version}`,
    codename: cleanCodename,
  };
}

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
  if (fam === "chatgpt") {
    const generation = canonicalChatGptGeneration(label, codename);
    if (generation) return generation;
  }
  const fallback = squash(label || codename || "");
  return {
    key: fallback.length >= 2 ? fallback : null,
    label: cleanStr(label),
    codename: cleanStr(codename),
  };
}

const RELEASE_LABEL_PATTERNS: ReadonlyArray<{ family: TrackedFamily; source: string }> = [
  { family: "chatgpt", source: "\\bGPT[-\\s]?\\d+(?:[.,]\\d+)*(?:\\s+(?:Sol|Terra|Luna))?\\b" },
  { family: "grok", source: "\\bGrok[-\\s]?\\d+(?:[.,]\\d+)*\\b" },
  { family: "claude", source: "\\b(?:Claude\\s+)?(?:Opus|Sonnet|Haiku|Fable)\\s+\\d+(?:[.,]\\d+)*\\b" },
  { family: "gemini", source: "\\bGemini\\s+\\d+(?:[.,]\\d+)*(?:\\s+(?:Pro|Flash|Ultra|Nano))?\\b" },
];

/**
 * Extract canonical model keys from a credible release announcement. Known
 * aliases catch codename-to-public-name launches (Bidi -> GPT-Live); family
 * patterns catch future numbered releases before the catalog is refreshed.
 */
export function versionKeysFromReleaseText(text: string | null | undefined): string[] {
  const raw = text ?? "";
  if (!raw.trim()) return [];
  const squashedText = squash(raw);
  const keys = new Set<string>();

  for (const entries of Object.values(FAMILY_ALIASES)) {
    for (const entry of entries) {
      if ((entry.releaseAliases ?? []).some((alias) => squashedText.includes(alias))) {
        keys.add(entry.key);
      }
    }
  }

  for (const pattern of RELEASE_LABEL_PATTERNS) {
    for (const match of raw.matchAll(new RegExp(pattern.source, "gi"))) {
      const key = canonicalVersionKey(pattern.family, match[0], null).key;
      if (key) keys.add(key);
    }
  }

  return [...keys];
}

// Squashed family stems stripped from a leading label word so a family-prefixed
// spelling ("Claude Sonnet 5") matches the same released token as "Sonnet 5".
const FAMILY_STEMS = ["claude", "chatgpt", "gpt", "gemini", "grok"];

// Canonical keys + every alias spelling of the FAMILY_ALIASES entries flagged
// `released`. Derived once, so flipping one `released` boolean retires a model
// across every consumer. Default-false: a novel unreleased leak can't be denied.
const RELEASED_TOKENS: ReadonlySet<string> = new Set(
  Object.values(FAMILY_ALIASES)
    .flat()
    .filter((e) => e.released)
    .flatMap((e) => [e.key, ...e.aliases]),
);

/**
 * Has this version already shipped? The radar tracks UNRELEASED models only, so a
 * launched version is retired from both the write path (`buildContribution`) and
 * the display merge (`mergeRumorRows`). Family-agnostic like the competitor deny:
 * a launched version is out regardless of which family it's tagged to.
 */
export function isReleasedVersion(
  family: string | null | undefined,
  label: string | null | undefined,
  codename: string | null | undefined,
): boolean {
  const { key } = canonicalVersionKey(family, label, codename);
  if (key && RELEASED_TOKENS.has(key)) return true;
  // Family-prefixed spellings ("Claude Sonnet 5") fall past the alias map; strip
  // a leading family stem and re-test the squashed remainder.
  for (const raw of [label, codename]) {
    const q = squash(raw);
    if (!q) continue;
    if (RELEASED_TOKENS.has(q)) return true;
    for (const stem of FAMILY_STEMS) {
      if (q.startsWith(stem) && RELEASED_TOKENS.has(q.slice(stem.length))) return true;
    }
  }
  return false;
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

function claimTypeRank(type: string | null | undefined): number {
  const index = CLAIM_TYPE_PRECEDENCE.indexOf(type ?? "other");
  return index >= 0 ? CLAIM_TYPE_PRECEDENCE.length - index : 0;
}

/** Minimal source shape the merge needs; richer fields pass through untouched. */
interface MergeSource {
  url?: string | null;
  platform?: string | null;
  handle?: string | null;
  verified?: boolean | null;
  followers?: number | null;
  score?: number | null;
  quotedStatusId?: string | null;
  source_quality?: SourceQuality | null;
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

function sourceSortRank(source: MergeSource | null | undefined): number {
  if (!source) return 0;
  const quality = inferSourceQuality(source);
  const qualityRank = sourceQualityRank(quality) * 10;
  const accountRank =
    quality === "tracked_leaker"
      ? 0
      : source.verified === true && (source.followers ?? 0) >= 10000
        ? 8
        : source.handle
          ? 4
          : 0;
  return Math.max(qualityRank, accountRank);
}

function withSourceQuality<T extends MergeSource>(source: T): T {
  return { ...source, source_quality: inferSourceQuality(source) } as T;
}

function compareMergeRows<T extends MergeableRumor>(a: T, b: T): number {
  const claimDelta = claimTypeRank(b.claim_type) - claimTypeRank(a.claim_type);
  if (claimDelta !== 0) return claimDelta;
  const sourceDelta =
    sourceSortRank((b.representative_sources ?? [])[0]) -
    sourceSortRank((a.representative_sources ?? [])[0]);
  if (sourceDelta !== 0) return sourceDelta;
  return tsNum(b.last_seen_at) - tsNum(a.last_seen_at);
}

function mergeGroup<T extends MergeableRumor>(group: T[]): T {
  const sortedByTime = [...group].sort((a, b) => tsNum(b.last_seen_at) - tsNum(a.last_seen_at));
  const newest = sortedByTime[0];
  const sortedByLead = [...group].sort(compareMergeRows);
  const lead = sortedByLead[0];
  const canon = canonicalVersionKey(lead.model_slug, lead.version_label, lead.codename);

  // Preserve every distinct codename attached to the now-single model card.
  // Legacy duplicate rows can contain a broad list on one row ("Sol, Terra,
  // Luna") and one repeated codename on another; unioning keeps the richer
  // display without repeating values.
  const codenameByKey = new Map<string, string>();
  for (const r of sortedByLead) {
    const canonicalCodename = canonicalVersionKey(
      r.model_slug,
      r.version_label,
      r.codename,
    ).codename ?? cleanStr(r.codename);
    for (const part of splitCompoundLabel(canonicalCodename)) {
      const key = squash(part);
      if (key && !codenameByKey.has(key)) codenameByKey.set(key, part);
    }
  }
  const mergedCodename = codenameByKey.size > 0 ? [...codenameByKey.values()].join(", ") : null;

  // Union representative sources by url (keeps the full original objects), then
  // surface credible / handled sources first so the card's lead stays sensible.
  const byUrl = new Map<string, MergeSource>();
  for (const r of group) {
    for (const s of r.representative_sources ?? []) {
      if (s && s.url) byUrl.set(s.url, withSourceQuality(s));
    }
  }
  const reps = [...byUrl.values()].sort(
    (a, b) =>
      sourceSortRank(b) - sourceSortRank(a) ||
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
  const etaSource = sortedByLead.find(
    (r) =>
      r.claim_type === lead.claim_type &&
      (cleanStr((r as { eta_text?: string | null }).eta_text) ||
        cleanStr((r as { eta_date?: string | null }).eta_date)),
  );

  const merged = { ...lead } as T;
  merged.version_label = canon.label ?? newest.version_label;
  merged.codename = mergedCodename ?? canon.codename ?? newest.codename;
  merged.claim_type = lead.claim_type;
  merged.mention_count = mentionCount;
  merged.platform_count = platformCount;
  merged.representative_sources = reps as T["representative_sources"];
  merged.last_seen_at = newest.last_seen_at;

  // Passthrough fields not in MergeableRumor (present on PublicRumorRow / RumorRow).
  const m = merged as unknown as Record<string, unknown>;
  m.has_credible_source = group.some((r) => (r as { has_credible_source?: boolean }).has_credible_source);
  m.eta_text = etaSource ? cleanStr((etaSource as { eta_text?: string | null }).eta_text) : null;
  m.eta_date = etaSource ? cleanStr((etaSource as { eta_date?: string | null }).eta_date) : null;
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
    if (isReleasedVersion(slug, r.version_label, r.codename)) continue;
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
