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
  /**
   * Optional ≤160-char description used ONLY for the meta description /
   * og / twitter tags. Keeps the visible `summary` copy untouched while
   * staying within search-snippet limits. Falls back to `summary`.
   */
  metaDescription?: string;
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
    slug: "fable-5-lifecycle-june-july-2026",
    title: "Fable 5's launch took 17% of tracked AI chatter. Its return from the government ban took 21%.",
    publishedAt: "2026-07-17",
    summary:
      "Launched June 9, suspended by government directive June 12, redeployed behind a stricter classifier July 1, farewell postponed twice. Five weeks of daily data on the strangest frontier-model lifecycle yet.",
    metaDescription:
      "Five weeks of daily sentiment data across Fable 5's launch, government suspension, classifier redeploy, and twice-extended farewell.",
    author: "David Kelly",
    tags: ["claude", "anthropic", "incident", "case-study"],
    relatedModelSlug: "claude",
    ogImage: "/research/fable-5-lifecycle-june-july-2026/og.png",
    dataset: {
      label: "Daily Fable 5 lifecycle series · Jun 1 – Jul 16, 2026 (CSV)",
      path: "/research/fable-5-lifecycle-june-july-2026/data.csv",
      description:
        "Daily Claude sentiment score with Fable/Mythos mention counts, corpus row totals, and refusal-language post counts. Source for every series in the article.",
      publishedAt: "2026-07-17",
      license: "MIT",
    },
  },
  {
    slug: "grok-45-launch-july-2026",
    title: "Grok 4.5's launch pop faded in five days. The audience it pulled in stayed.",
    publishedAt: "2026-07-17",
    summary:
      "What survives the messiest measurement week in our dataset: a tripled share of voice, a five-day sentiment pop, a feed that flipped from Musk-chatter to product-chatter, and a switching story that's real but smaller and more price-driven than the headlines.",
    metaDescription:
      "What our sentiment data can honestly attribute to Grok 4.5's launch: tripled share of voice, a five-day score pop, and a switching story smaller than the headlines.",
    author: "David Kelly",
    tags: ["grok", "cross-model", "case-study", "claude", "chatgpt"],
    relatedModelSlug: "grok",
    ogImage: "/research/grok-45-launch-july-2026/og.png",
    dataset: {
      label: "Daily cross-model launch-window series · Jun 1 – Jul 16, 2026 (CSV)",
      path: "/research/grok-45-launch-july-2026/data.csv",
      description:
        "Daily sentiment score, post volume, and eligible-post counts for all four tracked models, plus Grok share-of-chatter and Grok 4.5 mention counts. Source for every series in the article.",
      publishedAt: "2026-07-17",
      license: "MIT",
    },
  },
  {
    slug: "surface-segmentation-march-may-2026",
    title: "Claude Code lost 19 points during the cache bug. The rest of Claude lost 4.",
    publishedAt: "2026-05-16",
    summary:
      "Aggregate model scores treat each frontier model as one product. Sliced by product surface across 60 days of public posts, Claude Code and ChatGPT.com are where the conversation actually happens, and the same model's scores diverge sharply by surface during a regression.",
    author: "David Kelly",
    tags: ["methodology", "cross-model", "case-study", "claude", "chatgpt"],
    ogImage: "/research/surface-segmentation-march-may-2026/og.png",
    dataset: {
      label: "Daily per-surface LLM Vibes scores · Mar 15 – May 14, 2026 (CSV)",
      path: "/research/surface-segmentation-march-may-2026/data.csv",
      description:
        "Daily volume-weighted sentiment score per (model, product surface) with positive / negative / neutral counts and top-complaint label. Surface tagging via the lexical detector at src/lib/product-surface.ts.",
      publishedAt: "2026-05-16",
      license: "MIT",
    },
  },
  {
    slug: "claude-april-2026",
    title: "We Caught Claude's March Slide 28 Days Before Anthropic Confirmed It",
    publishedAt: "2026-04-25",
    updatedAt: "2026-04-26",
    summary:
      "Independent sentiment data caught Claude Code grumbling on March 26, the day Anthropic shipped the cache bug. 28 days before the postmortem.",
    author: "David Kelly",
    tags: ["claude", "anthropic", "postmortem", "incident", "case-study"],
    relatedModelSlug: "claude",
    ogImage: "/research/claude-april-2026/og.png",
    dataset: {
      label: "Daily LLM Vibes scores · Feb 15 – Apr 24, 2026 (CSV)",
      path: "/research/claude-april-2026/data.csv",
      description:
        "Daily volume-weighted sentiment score (0–100) per tracked model with positive / negative / neutral counts and top-complaint label. Source for every chart and number in this analysis.",
      publishedAt: "2026-04-25",
      license: "MIT",
    },
  },
  {
    slug: "how-llm-vibes-classifies-sentiment",
    title: "How LLM Vibes Classifies Sentiment",
    publishedAt: "2026-04-25",
    updatedAt: "2026-07-17",
    summary:
      "The full pipeline from scraper to score. Six sources, 12 complaint categories, a volume-weighted 0–100 score, and the failure modes we've documented but not yet solved.",
    metaDescription:
      "How LLM Vibes turns posts into scores: six sources, 12 complaint categories, a volume-weighted 0–100 score, and its known failure modes.",
    author: "David Kelly",
    tags: ["methodology"],
    ogImage: "/research/how-llm-vibes-classifies-sentiment/og.png",
  },
  {
    slug: "cross-model-deltas-march-april-2026",
    title: "When One AI Cracks: Cross-Model Sentiment, March–April 2026",
    publishedAt: "2026-04-25",
    updatedAt: "2026-04-26",
    summary:
      "Comparing absolute scores or even bug-window deltas across LLM Vibes models can mislead you. What actually caught Claude's March 2026 regression was the post-fix recovery shape: ChatGPT recovered, Gemini stayed flat, Claude kept sliding.",
    metaDescription:
      "Why cross-model score deltas mislead, and how the post-fix recovery shape, not the absolute drop, caught Claude's March 2026 regression.",
    author: "David Kelly",
    tags: ["cross-model", "case-study", "claude", "chatgpt", "gemini", "grok"],
    ogImage: "/research/cross-model-deltas-march-april-2026/og.png",
  },
];

export function getResearchPost(slug: string): ResearchPost | undefined {
  return RESEARCH_POSTS.find((post) => post.slug === slug);
}

export function getResearchPostsForModel(modelSlug: string): ResearchPost[] {
  return RESEARCH_POSTS
    .filter((post) => post.relatedModelSlug === modelSlug)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
