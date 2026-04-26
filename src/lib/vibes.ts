import { Sun, CloudSun, CloudLightning } from "lucide-react";
import {
  PUBLIC_COMPLAINT_LABELS,
  getPublicComplaintLabel,
} from "@/shared/public-taxonomy";

// Muted-text convention (apply across all public pages):
//   text-foreground       — primary statements, headings, score numbers
//   text-text-secondary   — body copy, default paragraph tone
//   text-text-tertiary    — meta, captions, timestamps, "/100", filter labels
// Avoid arbitrary `text-foreground/{60..90}` opacities in new code; route
// through one of these three. Tokens defined in tailwind.config.ts.

// Single source of truth for sentiment colors. Mirrors --primary, --warning,
// --destructive HSL triplets in src/index.css. Recharts and inline `style`
// consumers need raw HSL strings (not Tailwind classes), which is why a JS
// map exists alongside the CSS vars.
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

export const SENTIMENT_STYLES: Record<string, { label: string; classes: string }> = {
  positive: { label: "Positive", classes: "bg-primary/15 text-primary border-primary/20" },
  negative: { label: "Negative", classes: "bg-destructive/15 text-destructive border-destructive/30" },
  neutral: { label: "Neutral", classes: "bg-muted text-muted-foreground border-border" },
};

export function getVibeStatus(score: number) {
  if (score <= 40) return { label: "Bad Vibes", icon: CloudLightning, color: SENTIMENT_HSL.bad };
  if (score <= 65) return { label: "Mixed Signals", icon: CloudSun, color: SENTIMENT_HSL.mixed };
  return { label: "Good Vibes", icon: Sun, color: SENTIMENT_HSL.good };
}

// Maps a post sentiment to the unified left-border accent class. Used by
// chatter posts and recent-posts list items so the border-color language is
// consistent with `border-l-primary` (incident card, research featured card).
export function sentimentBorderClass(sentiment: string | null | undefined): string {
  if (sentiment === "positive") return "border-l-primary";
  if (sentiment === "negative") return "border-l-destructive";
  return "border-l-border";
}

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
