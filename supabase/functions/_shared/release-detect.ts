// Detect a "generally available NOW" launch announcement in scraped post text,
// and whether the source is credible enough to auto-retire the model from the
// rumors radar. Deterministic + Deno-free (unit-tested in `src/test`), it's the
// social backstop for the families the Models API can't reach (ChatGPT/Grok have
// no key in the secret store) and for codename launches.
//
// The gate is deliberately conservative — the failure mode is visible (a false
// positive hides a still-unreleased rumor). Two guards: (1) GA phrasing, not
// hype or future tense; (2) a credible source. A LIMITED/EAP release is NOT GA —
// a model in early access is still rumor-worthy, so it stays on the board.

import {
  OFFICIAL_VENDOR_HANDLES,
  inferSourceQuality,
  normalizeSourceHandle,
  type SourceQuality,
} from "./rumor-canon.ts";

// GA phrasing. Narrow on purpose: present-tense general availability only.
const GA_RE = new RegExp(
  "\\b(?:" +
    "now (?:available|live|out|powering)|" +
    "is (?:now )?(?:available|live)|" +
    "is now (?:the )?(?:default|preferred) model|" +
    "general availability|generally available|" +
    "released today|launched today|out now|shipped today|" +
    "available (?:starting today|to everyone|to all|for everyone|now in the api|in the api now)|" +
    "rolling out to (?:everyone|all users|all)|" +
    "(?:today,? )?we(?:['’]re| are) launching|" +
    "you can (?:now )?(?:use|try|access) it (?:now|today)" +
  ")\\b",
  "i",
);

// Strong public-GA wording wins if an announcement also references the preview
// it followed. Without this override, "general availability after our limited
// preview" would be rejected merely because both phrases appear in one post.
const PUBLIC_GA_RE =
  /\b(?:general availability|generally available|available (?:starting today|to everyone|to all|for everyone)|rolling out to (?:everyone|all users|all))\b/i;

// Explicitly NOT-GA contexts — a limited/preview release stays on the radar.
const LIMITED_RE =
  /\b(?:enterprise partners|early access|eap|waitlist|limited (?:preview|access|rollout)|select (?:users|customers)|private (?:preview|beta)|for testing)\b/i;

/** Does the post assert the model is generally available RIGHT NOW (not soon, not limited)? */
export function isReleaseAnnouncement(
  title: string | null | undefined,
  body: string | null | undefined,
): boolean {
  const text = `${title ?? ""} ${body ?? ""}`;
  if (!GA_RE.test(text)) return false;
  if (LIMITED_RE.test(text) && !PUBLIC_GA_RE.test(text)) return false;
  return true;
}

// Official vendor handles (lowercased, no @). A launch tweet from one of these,
// paired with GA phrasing, is about as authoritative a signal as exists.
const OFFICIAL_HANDLES: ReadonlySet<string> = new Set([
  ...OFFICIAL_VENDOR_HANDLES,
  "sama",
  "elonmusk",
  "google",
]);

/** Official vendor domain/handle, or a reported press scoop — trusted enough to retire a model. */
export function isCredibleReleaseSource(source: {
  url?: string | null;
  platform?: string | null;
  handle?: string | null;
  quotedStatusId?: string | null;
}): boolean {
  const q: SourceQuality = inferSourceQuality(source);
  if (q === "official" || q === "press_scoop") return true;
  return OFFICIAL_HANDLES.has(normalizeSourceHandle(source.handle));
}
