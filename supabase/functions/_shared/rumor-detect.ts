// Leak / rumor / launch-timing lexicon for the upcoming-model rumors radar.
//
// Two consumers, both gated so this only ever runs against posts ALREADY
// attributed to a tracked model (via `matchModels` + the codename `model_keywords`
// rows), so the lexicon doesn't need to re-assert the model — it only has to
// recognize "this is leak / stage / timing / return chatter about an unreleased
// version":
//   1. scrape-twitter / scrape-reddit-apify — a post that `isLikelyNonExperienceShare`
//      would normally DROP (announcement/news/promo-shaped) is KEPT when it also
//      matches here, so formally-worded leaks survive into `scraped_posts`.
//   2. aggregate-rumors — the SQL candidate pre-filter selects only posts whose
//      title/content match this lexicon before the (paid) Haiku extraction pass.
//
// Keep this TIGHT: broadening it widens the Haiku candidate set and raises cost.
// The aggregate-rumors migration mirrors this alternation as a Postgres `~*`
// pattern — keep the two in sync (see `RUMOR_LEXICON` / `RUMOR_LEXICON_SQL`).

// Source of truth. Each entry is a POSIX-compatible regex fragment (no anchors,
// no flags). Tested case-insensitively against `title + " " + body`.
export const RUMOR_LEXICON: readonly string[] = [
  // sightings / artifacts
  "leaked?",
  "spotted",
  "sighting",
  "model[- ]?string",
  "model[- ]?id",
  "api string",
  "sitemap",
  "changelog",
  "stealth",
  "cloaked",
  "codename",
  "arena",
  // stage / timing
  "incoming",
  "in testing",
  "early access",
  "\\bEAP\\b",
  "canary",
  "imminent",
  "dropping",
  "drops? (?:next|this)",
  "rolling out",
  "rolls? out",
  "release date",
  "coming (?:soon|next|this)",
  "(?:next|this) (?:week|month)",
  "any day now",
  "scheduled",
  // delay
  "delayed",
  "pushed back",
  "slipped",
  "postponed",
  "stalled",
  "no longer (?:releas|launch|drop)",
  "give us until",
  // return / re-add (e.g. Fable 5 / Mythos "suspended -> rumored to return")
  "returning",
  "re-?added?",
  "brought back",
  "back out",
  "reinstat",
  "restored?",
  // speculation
  "\\bsus\\b",
  "rumou?red?",
];

// JS-regex source string (used to build RUMOR_REGEX below and by the unit tests).
// The aggregate-rumors migration keeps a HAND-MIRRORED Postgres-ARE pattern for
// its `~*` candidate gate — keep the two in sync, noting word boundaries differ
// (JS `\b` here vs Postgres `\y` there).
export const RUMOR_LEXICON_SQL = RUMOR_LEXICON.join("|");

const RUMOR_REGEX = new RegExp(`(?:${RUMOR_LEXICON_SQL})`, "i");

/**
 * True when the post reads like leak / stage / timing / return chatter about an
 * unreleased model version. Used to bypass the announcement/news/promo drop in
 * the scrapers and as the candidate gate in aggregate-rumors.
 */
export function isLikelyRumorCandidate(
  title?: string | null,
  body?: string | null,
): boolean {
  const text = `${title ?? ""} ${body ?? ""}`;
  if (!text.trim()) return false;
  return RUMOR_REGEX.test(text);
}
