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

export type RumorClaimMode =
  | "observed_signal"
  | "reported_information"
  | "inference"
  | "speculation";

export type RumorEvidenceKind =
  | "artifact"
  | "firsthand_access"
  | "named_source"
  | "official_hint"
  | "prediction_market"
  | "none";

export interface SourceQualityInput {
  url?: string | null;
  platform?: string | null;
  handle?: string | null;
  snippet?: string | null;
  posted_at?: string | null;
  quotedStatusId?: string | null;
  source_quality?: string | null;
  claim_mode?: RumorClaimMode | null;
  evidence_kind?: RumorEvidenceKind | null;
  claim_confidence?: number | null;
}

// Tracked leaker handles (lowercased, no @). Mirrors scraper_config X search
// terms and the old KNOWN_LEAKERS export in rumor-rollup.ts.
export const TRACKED_LEAKER_HANDLES: ReadonlySet<string> = new Set([
  "synthwavedd",
  "btibor91",
  "apples_jimmy",
  "testingcatalog",
  "scaling01",
  "m1astra",
]);

// Security researchers and reverse engineers with a demonstrated primary-
// artifact track record. Their posts are labeled as artifact leaks rather than
// generic leaker reports so concrete app/API/source findings rank correctly.
export const ARTIFACT_LEAKER_HANDLES: ReadonlySet<string> = new Set([
  "fried_rice",
  "pankajkumar_dev",
]);

const PRESS_SCOOP_HANDLES: ReadonlySet<string> = new Set([
  "axios",
  "semafor",
  "theinformation",
  "fortunemagazine",
  "alexeheath",
  "haydenfield",
]);

// Company accounts are authoritative for previews and release status. Keep
// celebrity/executive accounts in release-detect only when their posts need to
// retire a launch; this smaller set stays precise enough for rumor cards too.
export const OFFICIAL_VENDOR_HANDLES: ReadonlySet<string> = new Set([
  "openai",
  "openaidevs",
  "anthropicai",
  "anthropic",
  "claudeai",
  "googledeepmind",
  "googleai",
  "geminiapp",
  "xai",
  "grok",
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

/** Recover an account handle from the canonical X/Bluesky URL when old rows did not store one. */
export function sourceHandleFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if ((host === "x.com" || host === "twitter.com") && parts[1] === "status") {
      return normalizeSourceHandle(parts[0]) || null;
    }
    if (host === "bsky.app" && parts[0] === "profile" && parts[2] === "post") {
      return normalizeSourceHandle(parts[1]) || null;
    }
  } catch {
    // Invalid external URLs are already rendered as inert text by the frontend.
  }
  return null;
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

  const handle = normalizeSourceHandle(source.handle) || sourceHandleFromUrl(source.url) || "";
  if (TRACKED_LEAKER_HANDLES.has(handle)) return "tracked_leaker";
  if (ARTIFACT_LEAKER_HANDLES.has(handle)) return "artifact_leak";
  if (PRESS_SCOOP_HANDLES.has(handle)) return "press_scoop";
  if (OFFICIAL_VENDOR_HANDLES.has(handle)) return "official";

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

function sourcePostToken(source: SourceQualityInput): string | null {
  const platform = (source.platform ?? "unknown").trim().toLowerCase() || "unknown";
  if (!source.url) return null;
  try {
    const parsed = new URL(source.url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if ((host === "x.com" || host === "twitter.com") && parts[1] === "status" && parts[2]) {
      return `${platform}:post:${parts[2]}`;
    }
    if (host === "bsky.app" && parts[0] === "profile" && parts[2] === "post" && parts[3]) {
      return `${platform}:post:${parts[3]}`;
    }
  } catch {
    // Invalid URLs fall through to ordinary URL identity.
  }
  return null;
}

/** All identities that can prove two source rows share one origin. */
export function sourceIdentityTokens(source: SourceQualityInput): string[] {
  const platform = (source.platform ?? "unknown").trim().toLowerCase() || "unknown";
  const tokens = new Set<string>();
  const handle = normalizeSourceHandle(source.handle) || sourceHandleFromUrl(source.url);
  if (handle) tokens.add(`${platform}:account:${handle}`);
  const ownPost = sourcePostToken(source);
  if (ownPost) tokens.add(ownPost);
  if (source.quotedStatusId) {
    // Numeric status ids are X ids even when a Reddit/HN post links them.
    const quotedPlatform = /^\d+$/.test(source.quotedStatusId) ? "twitter" : platform;
    tokens.add(`${quotedPlatform}:post:${source.quotedStatusId}`);
  }

  const host = hostnameFromUrl(source.url);
  if (host && (platform === "web" || platform === "press" || platform === "official")) {
    tokens.add(`${platform}:domain:${host}`);
  }
  if (tokens.size === 0) tokens.add(`${platform}:url:${source.url ?? "unknown"}`);
  return [...tokens];
}

/** Primary stable identity for sets/logging; use dedupeRumorSources for full echo linking. */
export function sourceIdentityKey(source: SourceQualityInput): string {
  const tokens = sourceIdentityTokens(source);
  return tokens.find((token) => token.includes(":account:")) ??
    tokens.find((token) => token.includes(":domain:")) ??
    tokens[tokens.length - 1];
}

/**
 * Keep the first (caller-ranked) source from each connected origin component.
 * Account, own-post, and quoted-post tokens make both repeated authors and
 * multi-account quote echoes collapse correctly.
 */
export function dedupeRumorSources<T extends SourceQualityInput>(sources: T[]): T[] {
  const parent = sources.map((_source, index) => index);
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
  sources.forEach((source, index) => {
    for (const token of sourceIdentityTokens(source)) {
      const owner = tokenOwner.get(token);
      if (owner == null) tokenOwner.set(token, index);
      else union(index, owner);
    }
  });
  const firstByRoot = new Map<number, T>();
  sources.forEach((source, index) => {
    const root = find(index);
    if (!firstByRoot.has(root)) firstByRoot.set(root, source);
  });
  return [...firstByRoot.values()];
}

/** Only curated sources or a concrete observed artifact can open a one-source card. */
export function isVettedRumorSource(source: SourceQualityInput): boolean {
  const quality = inferSourceQuality(source);
  return (
    quality === "official" ||
    quality === "tracked_leaker" ||
    quality === "press_scoop" ||
    quality === "artifact_leak" ||
    (source.claim_mode === "observed_signal" && source.evidence_kind === "artifact")
  );
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
      key: "gemini31pro",
      label: "Gemini 3.1 Pro",
      codename: null,
      aliases: ["gemini31pro"],
      released: true,
      releasePrompt: "Gemini 3.1 Pro",
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
      key: "gemini36flash",
      label: "Gemini 3.6 Flash",
      codename: null,
      aliases: ["gemini36flash"],
      released: true,
      releasePrompt: "Gemini 3.6 Flash",
    },
    {
      // Exact spelling only — a bare "Flash-Lite" alias would wrongly retire the
      // next Flash-Lite the way "Flash Cyber" safely can't (that name is unique
      // to one release).
      key: "gemini35flashlite",
      label: "Gemini 3.5 Flash-Lite",
      codename: null,
      aliases: ["gemini35flashlite"],
      released: true,
      releasePrompt: "Gemini 3.5 Flash-Lite",
    },
    {
      key: "gemini35flashcyber",
      label: "Gemini 3.5 Flash Cyber",
      codename: null,
      aliases: ["gemini35flashcyber", "35flashcyber", "flashcyber"],
      released: true,
      releasePrompt: "Gemini 3.5 Flash Cyber",
      releaseAliases: ["flashcyber"],
    },
    {
      key: "gemini35pro",
      label: "Gemini 3.5 Pro",
      codename: null,
      // Bare "Gemini 3.5" chatter means the pending Pro (Flash 3.5 already
      // shipped), so fold it in rather than surfacing a duplicate card.
      aliases: ["35", "gemini35", "35pro", "gemini35pro"],
    },
  ],
  grok: [
    {
      key: "grok45",
      label: "Grok 4.5",
      codename: null,
      aliases: ["grok45"],
      released: true,
    },
    {
      // xAI publishes no Models API, so the auto-retire layer can only catch a
      // Grok launch through a credible "generally available" post. 4.6 shipped
      // without one and sat on the radar as an in-testing rumor — this manual
      // entry is the documented backstop for exactly that gap.
      key: "grok46",
      label: "Grok 4.6",
      codename: null,
      aliases: ["grok46"],
      released: true,
      releasePrompt: "Grok 4.6 and earlier",
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
  snippet?: string | null;
  posted_at?: string | null;
  verified?: boolean | null;
  followers?: number | null;
  score?: number | null;
  quotedStatusId?: string | null;
  source_quality?: SourceQuality | null;
  claim_mode?: RumorClaimMode | null;
  evidence_kind?: RumorEvidenceKind | null;
  claim_confidence?: number | null;
}

/** Minimal row shape both PublicRumorRow and the backend RumorRow satisfy. */
export interface MergeableRumor {
  model_slug: string;
  version_label: string | null;
  codename: string | null;
  claim_type: string;
  claim_summary: string;
  signals?: string | null;
  mention_count: number;
  platform_count: number;
  has_credible_source?: boolean;
  representative_sources: MergeSource[] | null;
  last_seen_at: string | null;
}

const ARTIFACT_SIGNAL_RE =
  /\b(?:api|app|cursor|config(?:uration)?|feature[- ]?flag|model[- ]?(?:id|string|selector)|sitemap|changelog|source code|checkpoint|canary|arena|endpoint)\b/i;
const SPECULATIVE_SIGNAL_RE = /\b(?:speculative|wish|guess|prediction|comparison|vibes?)\b/i;
const STRICT_SPECULATION_RE = [
  /^\s*if\b/i,
  /\bif i were\b/i,
  /\bwould not be surprised if\b/i,
  /\bi (?:think|guess|bet|hope|wish|expect)\b/i,
  /\b(?:needs?|would need|has to)\b[^.!?\n]{0,120}\b(?:hit|be|make|release|launch|drop)\b/i,
  /\b(?:should|could|might|would)\b[^.!?\n]{0,80}\b(?:make room|be interesting|be better|contend|hit)\b/i,
];

/** Strict fallback for legacy rows created before claim_mode was stored. */
export function isSpeculativeRumorSource(source: SourceQualityInput): boolean {
  if (source.claim_mode === "speculation") return true;
  if (source.claim_mode) return false;
  const snippet = (source.snippet ?? "").trim();
  return snippet.length > 0 && STRICT_SPECULATION_RE.some((pattern) => pattern.test(snippet));
}

function sourceEvidenceRank(source: MergeSource | null | undefined): number {
  if (!source || isSpeculativeRumorSource(source)) return -100;
  const qualityRank = sourceQualityRank(source) * 10;
  const evidenceRank =
    source.evidence_kind === "artifact"
      ? 38
      : source.evidence_kind === "official_hint"
        ? 34
        : source.evidence_kind === "prediction_market"
          ? 20
          : source.evidence_kind === "firsthand_access"
            ? 18
            : source.evidence_kind === "named_source"
              ? 12
              : 0;
  return Math.max(qualityRank, evidenceRank);
}

function sourceSortRank(source: MergeSource | null | undefined): number {
  if (!source) return 0;
  const quality = inferSourceQuality(source);
  const evidenceRank = sourceEvidenceRank(source);
  const accountRank =
    quality === "tracked_leaker"
      ? 0
      : source.verified === true && (source.followers ?? 0) >= 10000
        ? 8
        : source.handle
          ? 4
          : 0;
  return Math.max(evidenceRank, accountRank);
}

function withSourceQuality<T extends MergeSource>(source: T): T {
  const recoveredHandle = normalizeSourceHandle(source.handle) || sourceHandleFromUrl(source.url);
  return {
    ...source,
    handle: normalizeSourceHandle(source.handle) ? source.handle : recoveredHandle,
    source_quality: inferSourceQuality(source),
  } as T;
}

function rowEvidenceRank<T extends MergeableRumor>(row: T): number {
  const sources = (row.representative_sources ?? []).filter((source) => !isSpeculativeRumorSource(source));
  const sourceRank = Math.max(...sources.map(sourceEvidenceRank), sources.length > 0 ? 0 : -100);
  const signals = row.signals ?? "";
  const signalRank = ARTIFACT_SIGNAL_RE.test(signals)
    ? 36
    : SPECULATIVE_SIGNAL_RE.test(signals)
      ? -20
      : 0;
  return Math.max(sourceRank, signalRank);
}

function compareMergeRows<T extends MergeableRumor>(a: T, b: T): number {
  const evidenceDelta = rowEvidenceRank(b) - rowEvidenceRank(a);
  if (evidenceDelta !== 0) return evidenceDelta;
  const sourceDelta =
    sourceSortRank((b.representative_sources ?? [])[0]) -
    sourceSortRank((a.representative_sources ?? [])[0]);
  if (sourceDelta !== 0) return sourceDelta;
  const claimDelta = claimTypeRank(b.claim_type) - claimTypeRank(a.claim_type);
  if (claimDelta !== 0) return claimDelta;
  return tsNum(b.last_seen_at) - tsNum(a.last_seen_at);
}

function identitySpecificity<T extends MergeableRumor>(row: T): number {
  const label = cleanStr(row.version_label);
  const codename = cleanStr(row.codename);
  return (label ? 20 : 0) + (codename ? 10 : 0);
}

function identityTokens<T extends MergeableRumor>(row: T): string[] {
  const slug = row.model_slug.toLowerCase();
  const tokens = new Set<string>();
  const canon = canonicalVersionKey(slug, row.version_label, row.codename);
  if (canon.key) tokens.add(canon.key);
  const label = squash(row.version_label);
  if (label.length >= 2) tokens.add(label);
  for (const part of splitCompoundLabel(row.codename)) {
    const raw = squash(part);
    if (raw.length >= 2) tokens.add(raw);
    const key = canonicalVersionKey(slug, null, part).key;
    if (key) tokens.add(key);
  }
  return [...tokens];
}

function compareSources(a: MergeSource, b: MergeSource): number {
  return (
    sourceSortRank(b) - sourceSortRank(a) ||
    Number(Boolean(b.verified)) - Number(Boolean(a.verified)) ||
    tsNum(b.posted_at) - tsNum(a.posted_at) ||
    (b.score ?? 0) - (a.score ?? 0)
  );
}

function mergeIndependentSources(group: MergeableRumor[]): MergeSource[] {
  const sources = group
    .flatMap((row) => {
      const artifact = ARTIFACT_SIGNAL_RE.test(row.signals ?? "");
      const speculative = SPECULATIVE_SIGNAL_RE.test(row.signals ?? "") && !artifact;
      return (row.representative_sources ?? [])
        .filter((source) => !speculative || isVettedRumorSource(source))
        .map((source) => artifact
          ? {
            ...source,
            claim_mode: source.claim_mode ?? "observed_signal",
            evidence_kind: source.evidence_kind ?? "artifact",
          }
          : source);
    })
    .filter((source): source is MergeSource => Boolean(source?.url))
    .map(withSourceQuality)
    .filter((source) => !isSpeculativeRumorSource(source))
    .sort(compareSources);
  return dedupeRumorSources(sources);
}

function mergeGroup<T extends MergeableRumor>(group: T[]): T {
  const sortedByTime = [...group].sort((a, b) => tsNum(b.last_seen_at) - tsNum(a.last_seen_at));
  const newest = sortedByTime[0];
  const sortedByLead = [...group].sort(compareMergeRows);
  const lead = sortedByLead[0];
  const identityLead = [...group].sort(
    (a, b) => identitySpecificity(b) - identitySpecificity(a) || tsNum(b.last_seen_at) - tsNum(a.last_seen_at),
  )[0];
  const canon = canonicalVersionKey(
    identityLead.model_slug,
    identityLead.version_label,
    identityLead.codename,
  );

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

  // A source account is one corroborating origin even when it posted repeatedly.
  // Strictly hypothetical legacy snippets are removed before counts and display.
  const hadRepresentativeEvidence = group.some((row) =>
    (row.representative_sources ?? []).some((source) => Boolean(source?.url))
  );
  const reps = mergeIndependentSources(group);
  const repPlatforms = new Set(reps.map((s) => s.platform).filter(Boolean));
  // Old rows retained only four representative URLs, so exact historic origin
  // counts cannot be reconstructed. Prefer the evidence we can audit instead of
  // carrying forward opaque tail counts that may contain echoes/speculation.
  const platformCount = reps.length > 0
    ? repPlatforms.size
    : hadRepresentativeEvidence
      ? 0
      : Math.max(...group.map((r) => r.platform_count ?? 0), 0);
  const mentionCount = reps.length > 0
    ? reps.length
    : hadRepresentativeEvidence
      ? 0
      : Math.max(...group.map((r) => r.mention_count ?? 0), 0);

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
  merged.version_label = canon.label ?? identityLead.version_label ?? newest.version_label;
  merged.codename = mergedCodename ?? canon.codename ?? identityLead.codename ?? newest.codename;
  merged.claim_type = lead.claim_type;
  merged.mention_count = mentionCount;
  merged.platform_count = platformCount;
  merged.representative_sources = reps as T["representative_sources"];
  merged.last_seen_at = newest.last_seen_at;

  // Passthrough fields not in MergeableRumor (present on PublicRumorRow / RumorRow).
  const m = merged as unknown as Record<string, unknown>;
  m.has_credible_source = reps.some(isVettedRumorSource);
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
 * card each. In addition to the maintained alias catalog, rows are connected by
 * identities explicitly observed together: "Opus 5" + codename "Honeycomb"
 * bridges a later codename-only Honeycomb row automatically. Singletons pass
 * through with canonical display identity applied.
 */
export function mergeRumorRows<T extends MergeableRumor>(rows: T[]): T[] {
  const filtered: T[] = [];
  for (const r of rows ?? []) {
    const slug = (r.model_slug ?? "").toLowerCase();
    if (!TRACKED_FAMILIES.has(slug)) continue;
    if (isNonFrontierLabel(slug, r.version_label, r.codename)) continue;
    if (isReleasedVersion(slug, r.version_label, r.codename)) continue;
    filtered.push(r);
  }

  const parent = filtered.map((_row, index) => index);
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
  filtered.forEach((row, index) => {
    const slug = row.model_slug.toLowerCase();
    for (const token of identityTokens(row)) {
      const scoped = `${slug}:${token}`;
      const owner = tokenOwner.get(scoped);
      if (owner == null) tokenOwner.set(scoped, index);
      else union(index, owner);
    }
  });

  const groups = new Map<number, T[]>();
  filtered.forEach((row, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(row);
    groups.set(root, group);
  });

  const out: T[] = [];
  for (const group of groups.values()) out.push(mergeGroup(group));
  return out;
}

/**
 * Public quality gate after display-time source cleanup. Curated/artifact
 * sources can surface alone; untracked reports need either two platforms or
 * three independent origins on one platform.
 */
export function isStrongPublicRumor(row: MergeableRumor): boolean {
  const sources = (row.representative_sources ?? []).filter(
    (source) => source?.url && !isSpeculativeRumorSource(source),
  );
  if (sources.length === 0) return false;
  if (sources.some(isVettedRumorSource)) return true;
  const origins = new Set(sources.map(sourceIdentityKey));
  const platforms = new Set(sources.map((source) => source.platform).filter(Boolean));
  const sourceCount = Math.max(origins.size, row.mention_count ?? 0);
  const platformCount = Math.max(platforms.size, row.platform_count ?? 0);
  return sourceCount >= 3 || (sourceCount >= 2 && platformCount >= 2);
}

/** Evidence-first board ordering and corroboration-meter input. */
export function rumorStrengthScore(row: MergeableRumor): number {
  const sources = (row.representative_sources ?? []).filter(
    (source) => source?.url && !isSpeculativeRumorSource(source),
  );
  const sourceRank = Math.max(...sources.map(sourceEvidenceRank), 0);
  const signalRank = ARTIFACT_SIGNAL_RE.test(row.signals ?? "") ? 36 : 0;
  const evidence = Math.max(sourceRank, signalRank);
  return evidence * 10_000 + (row.platform_count ?? 0) * 100 + (row.mention_count ?? 0);
}
