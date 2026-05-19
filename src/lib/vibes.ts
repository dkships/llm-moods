import {
  PUBLIC_COMPLAINT_LABELS,
  getPublicComplaintLabel,
} from "@/shared/public-taxonomy";

// Single source of truth for sentiment colors. Per the UX polish rules,
// sentiment hue may appear in exactly three places site-wide: the score
// number text, the 6px top accent bar on a ModelCard, and the single chart
// line stroke on VibesChart. Anywhere else (vibe label, trend caption,
// sparkline, complaint percent, etc.) routes through the neutral
// `text-foreground` / `text-text-secondary` / `text-text-tertiary` scale.
const SENTIMENT_HSL = {
  good: "hsl(142 72% 50%)",
  mixed: "hsl(38 92% 50%)",
  bad: "hsl(0 70% 55%)",
} as const;

export const COMPLAINT_LABELS = PUBLIC_COMPLAINT_LABELS;

export const SOURCE_LABELS: Record<string, string> = {
  reddit: "Reddit",
  hackernews: "Hacker News",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  lobsters: "Lobsters",
  lemmy: "Lemmy",
  devto: "Dev.to",
  stackoverflow: "Stack Overflow",
  medium: "Medium",
  discourse: "Discourse",
  github: "GitHub",
  twitter: "𝕏",
};

export function getVibeStatus(score: number) {
  if (score <= 40) return { label: "Bad Vibes", color: SENTIMENT_HSL.bad };
  if (score <= 65) return { label: "Mixed Signals", color: SENTIMENT_HSL.mixed };
  return { label: "Good Vibes", color: SENTIMENT_HSL.good };
}

// Sample-size warning threshold for asymmetric "Limited sample" notes on
// the model detail page and chart tooltips. Mirrors DEFAULT_MIN_POSTS=5 in
// vibes-scoring.ts: below this floor the smoothing weights tip heavily
// toward the previous day, so the surfaced score is mostly inertia.
export const LIMITED_SAMPLE_THRESHOLD = 5;

export function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function getPacificDateLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const lookup = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
}

export function formatSourceDisplay(source: string): { emoji: string; label: string } {
  if (source === "reddit") return { emoji: "🟠", label: "Reddit" };
  if (source === "hackernews") return { emoji: "🟡", label: "Hacker News" };
  if (source === "mastodon") return { emoji: "🟣", label: "Mastodon" };
  if (source === "lobsters") return { emoji: "🦞", label: "Lobsters" };
  if (source === "bluesky") return { emoji: "🔵", label: "Bluesky" };
  if (source === "lemmy") return { emoji: "🟢", label: "Lemmy" };
  if (source === "devto") return { emoji: "📝", label: "Dev.to" };
  if (source === "stackoverflow") return { emoji: "📚", label: "Stack Overflow" };
  if (source === "medium") return { emoji: "✍️", label: "Medium" };
  if (source === "discourse") return { emoji: "💬", label: "Discourse" };
  if (source === "github") return { emoji: "🐙", label: "GitHub" };
  if (source === "twitter") return { emoji: "⚪", label: "𝕏" };
  return { emoji: "⚪", label: source };
}

export function formatComplaintLabel(category: string | null | undefined): string {
  if (!category) return "Unknown";
  return getPublicComplaintLabel(category);
}

/** Decode common HTML entities found in scraped content */
export function decodeHTMLEntities(text: string): string {
  if (!text || !text.includes("&")) return text;
  const entities: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    "&apos;": "'", "&#x27;": "'", "&#x2F;": "/", "&#39;": "'",
    "&nbsp;": " ",
  };
  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.split(entity).join(char);
  }
  // Handle numeric entities: &#NNN; and &#xHH;
  result = result.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return result;
}

export const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.45, ease: [0, 0, 0.2, 1] as const },
  }),
};
