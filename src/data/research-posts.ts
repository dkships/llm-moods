import type { ModelSlug } from "./vendor-events";

export type ResearchTag =
  | "claude"
  | "chatgpt"
  | "gemini"
  | "grok"
  | "anthropic"
  | "postmortem"
  | "incident"
  | "methodology"
  | "case-study"
  | "cross-model";

/**
 * Metadata for a downloadable dataset companion to the article.
 * Surfaced in-body as a download link and emitted as schema.org Dataset
 * JSON-LD for primary-source-citing search engines.
 */
export interface ResearchPostDataset {
  /** Human-readable label for the download link */
  label: string;
  /** Public path (served from /public, e.g. "/research/claude-april-2026/data.csv") */
  path: string;
  description: string;
  /** ISO 8601 — last time the file was regenerated */
  publishedAt: string;
  /** Optional license identifier; defaults to MIT to match the repo */
  license?: string;
}

export interface ResearchPost {
  /** URL segment, e.g. "claude-april-2026" */
  slug: string;
  title: string;
  publishedAt: string; // YYYY-MM-DD
  updatedAt?: string;
  /** 1-2 sentence plain-text used in the index card and OG description */
  summary: string;
  author: string;
  tags: ResearchTag[];
  /** Drives the "Recent incident analysis" card on /model/:slug */
  relatedModelSlug?: ModelSlug;
  /** Optional companion dataset for download + Dataset JSON-LD */
  dataset?: ResearchPostDataset;
  /** Optional path-relative URL to a 1200x630 OG card image */
  ogImage?: string;
}

/**
 * Article metadata only. Body components live in `src/data/research/<slug>.tsx`
 * and are imported lazily by `ResearchPost.tsx` via `RESEARCH_BODIES`. This
 * keeps `research-posts.ts` JSX-free so build-time scripts (e.g.
 * `scripts/generate-rss.ts`) can import this module under plain Node.
 */
export const RESEARCH_POSTS: ResearchPost[] = [
  {
    slug: "claude-april-2026",
    title: "We Caught Claude's March Slide 28 Days Before Anthropic Confirmed It",
    publishedAt: "2026-04-25",
    summary:
      "Independent sentiment data caught Claude Code grumbling on March 26, the day Anthropic shipped the cache bug — 28 days before the postmortem.",
    author: "David Kelly",
    tags: ["claude", "anthropic", "postmortem", "incident", "case-study"],
    relatedModelSlug: "claude",
    ogImage: "/research/claude-april-2026/og.png",
    dataset: {
      label: "Daily LLM Vibes scores · Feb 15 – Apr 24, 2026 (CSV)",
      path: "/research/claude-april-2026/data.csv",
      description:
        "Daily volume-weighted sentiment score (0–100) per tracked model with positive / negative / neutral counts and top-complaint label. Source for every chart and number in this analysis.",
      publishedAt: "2026-04-26",
      license: "MIT",
    },
  },
  {
    slug: "how-llm-vibes-classifies-sentiment",
    title: "How LLM Vibes Classifies Sentiment",
    publishedAt: "2026-04-26",
    summary:
      "The full pipeline from scraper to score. Six platforms, 12 complaint categories, a volume-weighted 0–100 score, and the failure modes we've documented but not yet solved.",
    author: "David Kelly",
    tags: ["methodology"],
    ogImage: "/research/how-llm-vibes-classifies-sentiment/og.png",
  },
  {
    slug: "cross-model-deltas-march-april-2026",
    title: "When One AI Cracks: Cross-Model Sentiment, March–April 2026",
    publishedAt: "2026-04-26",
    summary:
      "Comparing absolute scores across LLM Vibes models will mislead you. Comparing each model's delta from its own baseline is what caught Claude's March 2026 regression.",
    author: "David Kelly",
    tags: ["cross-model", "case-study", "claude", "chatgpt", "gemini", "grok"],
    ogImage: "/research/cross-model-deltas-march-april-2026/og.png",
  },
];

export function getResearchPost(slug: string): ResearchPost | undefined {
  return RESEARCH_POSTS.find((post) => post.slug === slug);
}

export function getResearchPostsForModel(modelSlug: string): ResearchPost[] {
  return RESEARCH_POSTS.filter((post) => post.relatedModelSlug === modelSlug);
}
