// Turn released model IDs from the Anthropic / Gemini Models APIs into the
// squashed `version_key` tokens the rumors radar uses, so a shipped model can
// auto-retire its rumor rows. Deno-free with a single import (`squash`), so it
// bundles in the edge runtime and is unit-tested in `src/test/rumors.test.ts`.
//
// The Models API only ever lists PUBLIC ids, never pre-release codenames — so
// this reliably catches version-numbered launches (Sonnet 5, Gemini 3.x) and a
// codename whose tracked key already equals the shipped token (Fable 5 → fable5).
// OpenAI's public RSS and the credible-source social layer cover families without
// a Models API key. A renamed codename is linked through FAMILY_ALIASES.

import { squash, versionKeysFromReleaseText } from "./rumor-canon.ts";
import { isReleaseAnnouncement } from "./release-detect.ts";

export interface OfficialReleaseFeedItem {
  title: string;
  description: string;
  link: string;
  category: string | null;
  publishedAt: string | null;
}

function decodeXmlText(value: string | null): string {
  return (value ?? "")
    .replace(/^\s*<!\[CDATA\[/, "")
    .replace(/\]\]>\s*$/, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function xmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return decodeXmlText(match?.[1] ?? null);
}

/** Parse the fields needed from OpenAI's public RSS feed without an XML dependency. */
export function parseOpenAiReleaseFeed(xml: string | null | undefined): OfficialReleaseFeedItem[] {
  const items = (xml ?? "").match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  return items.map((item) => ({
    title: xmlTag(item, "title"),
    description: xmlTag(item, "description"),
    link: xmlTag(item, "link"),
    category: xmlTag(item, "category") || null,
    publishedAt: xmlTag(item, "pubDate") || null,
  })).filter((item) => item.title.length > 0);
}

/**
 * Derive shipped version keys only from Product items with explicit GA wording.
 * Preview announcements remain excluded even when their title names a model.
 */
export function openAiReleasedTokensFromRss(xml: string | null | undefined): string[] {
  const tokens = new Set<string>();
  for (const item of parseOpenAiReleaseFeed(xml)) {
    if (item.category?.toLowerCase() !== "product") continue;
    if (!isReleaseAnnouncement(item.title, item.description)) continue;
    for (const token of versionKeysFromReleaseText(`${item.title} ${item.description}`)) {
      tokens.add(token);
    }
  }
  return [...tokens];
}

// Leading family words to also strip: people say "Sonnet 5" (→ sonnet5), not
// "Claude Sonnet 5" — but the Anthropic id is `claude-sonnet-5`. Gemini ids keep
// "gemini" and so do the rumors, so the full squash already lines up there.
const STEMS = ["claude", "gpt", "gemini", "grok"];

/**
 * A model id → the set of `version_key` tokens that should match it. Strips the
 * `models/` prefix (Gemini), a trailing dated snapshot (`-20251001` / `@...`),
 * and channel suffixes, then yields the full squash AND a family-stem-stripped
 * squash. e.g. `claude-sonnet-5` → ["claudesonnet5","sonnet5"];
 * `models/gemini-3-pro` → ["gemini3pro","3pro"].
 */
export function modelIdToTokens(id: string | null | undefined): string[] {
  let s = (id ?? "").trim().toLowerCase().replace(/^models\//, "");
  s = s.replace(/[-@]\d{6,8}$/, "").replace(/-(?:latest|preview|exp|experimental|thinking)$/g, "");
  const full = squash(s);
  const tokens = new Set<string>();
  if (full.length >= 3) tokens.add(full);
  for (const stem of STEMS) {
    if (full.startsWith(stem) && full.length > stem.length + 2) {
      tokens.add(full.slice(stem.length));
    }
  }
  return [...tokens];
}

/** Union of `version_key` tokens across every provided list of model ids. */
export function deriveReleasedTokens(...idLists: Array<Array<string | null | undefined>>): string[] {
  const out = new Set<string>();
  for (const list of idLists) {
    for (const id of list ?? []) {
      for (const t of modelIdToTokens(id)) out.add(t);
    }
  }
  return [...out];
}
