import { Sun, CloudSun, CloudLightning } from "lucide-react";

export const COMPLAINT_LABELS: Record<string, string> = {
  lazy_responses: "Lazy responses",
  hallucinations: "Hallucinations",
  refusals: "Refusals",
  coding_quality: "Coding quality",
  speed: "Speed",
  general_drop: "General drop",
};

export const SOURCE_LABELS: Record<string, string> = {
  reddit: "Reddit",
  hackernews: "Hacker News",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  lobsters: "Lobsters",
};

export const SENTIMENT_STYLES: Record<string, { label: string; classes: string }> = {
  positive: { label: "Positive", classes: "bg-primary/15 text-primary border-primary/20" },
  negative: { label: "Negative", classes: "bg-destructive/15 text-destructive border-destructive/20" },
  neutral: { label: "Neutral", classes: "bg-muted text-muted-foreground border-border" },
};

export function getVibeStatus(score: number) {
  if (score <= 40) return { label: "Bad Vibes", icon: CloudLightning };
  if (score <= 65) return { label: "Mixed Signals", icon: CloudSun };
  return { label: "Good Vibes", icon: Sun };
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

export function formatSourceDisplay(source: string): { emoji: string; label: string } {
  if (source === "reddit") return { emoji: "🟠", label: "Reddit" };
  if (source === "hackernews") return { emoji: "🟡", label: "HN" };
  return { emoji: "🔵", label: "Bluesky" };
}

export const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.45, ease: [0, 0, 0.2, 1] as const },
  }),
};
