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
    slug: "gpt-6-2-astra-launch-claims-vs-reception-2026",
    title: "The first Astra opened at 69% positive. GPT-6.2 opened at 43%.",
    publishedAt: "2026-11-21",
    summary:
      "OpenAI called GPT-6.2 Astra and Sol a new standard for professional work. One early reviewer called them unusable, and Sam Altman's own launch thread said they need to be nicer to work with. In two samples, about 4 in 10 posts that took a side were positive. For the first Astra it was 7 in 10.",
    metaDescription:
      "GPT-6.2 Astra and Sol: what OpenAI claimed and how public posts received it. 43% positive against 69% for the first Astra, checked on a second graded sample.",
    author: "David Kelly",
    tags: ["chatgpt", "cross-model", "case-study"],
    relatedModelSlug: "chatgpt",
    ogImage: "/research/gpt-6-2-astra-launch-claims-vs-reception-2026/og.png",
    dataset: {
      label: "Daily ChatGPT score + Astra and GPT-6.2 mention tone · Aug 27 – Nov 20, 2026 (CSV)",
      path: "/research/gpt-6-2-astra-launch-claims-vs-reception-2026/data.csv",
      description:
        "Daily ChatGPT sentiment score and eligible posts, plus positive, negative and neutral counts of relevant posts naming Astra or GPT-6.2. Companion files hold the ten-launch comparison, 2,046 independently graded Hacker News and Bluesky posts, and the classifier cross-check.",
      publishedAt: "2026-11-21",
      license: "MIT",
    },
  },
  {
    slug: "opus-5-5-vs-opus-5-launch-sentiment-2026",
    title: "Opus 5.5 got the warmest Claude launch we've measured. Opus 5 looked warm too, for three days.",
    publishedAt: "2026-10-01",
    updatedAt: "2026-11-21",
    summary:
      "Everyone was waiting for an Opus 5.1 to fix Opus 5. Anthropic shipped Opus 5.5 instead, and over six days the Claude score rose 27 points and posts naming it warmed up after day two. Opus 5 opened strong too, then cooled by day four. OpenAI's GPT-6 Sol and Luna launched the same day and landed flat.",
    metaDescription:
      "Six days of launch sentiment for Opus 5.5 vs Opus 5, and GPT-6 Sol/Luna vs GPT-5.6: Opus 5.5 warmed up after day two, GPT-6 landed flat. Checked on 3,700 posts.",
    author: "David Kelly",
    tags: ["claude", "anthropic", "chatgpt", "cross-model", "case-study"],
    relatedModelSlug: "claude",
    ogImage: "/research/opus-5-5-vs-opus-5-launch-sentiment-2026/og.png",
    dataset: {
      label: "Daily Claude score + Opus/Fable mention tone · Jul 13 – Sep 27, 2026 (CSV)",
      path: "/research/opus-5-5-vs-opus-5-launch-sentiment-2026/data.csv",
      description:
        "Daily Claude sentiment score and eligible posts, plus positive and negative counts of relevant posts naming Opus 5, Opus 5.5 and Fable 5.1, and all posts naming Opus 5.1. Source for every series in the article.",
      publishedAt: "2026-10-01",
      license: "MIT",
    },
  },
  {
    slug: "fable-5-lifecycle-june-july-2026",
    title: "Fable 5's launch took 17% of tracked AI chatter. Its return from the government ban took 23%.",
    publishedAt: "2026-07-17",
    updatedAt: "2026-11-21",
    summary:
      "Launched June 9, suspended by government directive June 12, redeployed behind a stricter classifier July 1, then kept in paid plans after two deadline extensions. Its return week drew 23% of tracked AI chatter, against 17% for launch week.",
    metaDescription:
      "Daily sentiment data across Fable 5's launch, government suspension, classifier redeploy and deadline extensions, June 1 to July 16, 2026.",
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
    title: "Grok 4.5's launch pop faded in five days. Nine days in, its share of chatter was still triple.",
    publishedAt: "2026-07-17",
    updatedAt: "2026-11-21",
    summary:
      "What holds up from a messy measurement week: a tripled share of voice that was still there nine days in, a five-day sentiment pop, a feed that flipped from Musk posts to product posts, and a switching story that's real but smaller and more price-driven than the headlines.",
    metaDescription:
      "What the sentiment data can attribute to Grok 4.5's launch: a tripled share of voice, a five-day score pop, and a switching story smaller than the headlines.",
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
    updatedAt: "2026-11-21",
    summary:
      "Aggregate model scores treat each frontier model as one product. Sliced by product surface across two months of public posts, Claude Code's score fell about 19 points during the cache-bug window while the rest of Claude fell about 4, and most of that gap opened in the last five days.",
    author: "David Kelly",
    tags: ["methodology", "cross-model", "case-study", "claude", "chatgpt"],
    ogImage: "/research/surface-segmentation-march-may-2026/og.png",
    dataset: {
      label: "Daily per-surface LLM Vibes scores · Mar 15 – May 14, 2026 (CSV)",
      path: "/research/surface-segmentation-march-may-2026/data.csv",
      description:
        "Daily sentiment score per (model, product surface) with positive / negative / neutral counts and top-complaint label. Cells under five posts are omitted, and ChatGPT's app surface matches any post that says ChatGPT. Surface tagging via the lexical detector at src/lib/product-surface.ts.",
      publishedAt: "2026-05-16",
      license: "MIT",
    },
  },
  {
    slug: "claude-april-2026",
    title: "We caught Claude's March slide 28 days before Anthropic confirmed it",
    publishedAt: "2026-04-25",
    updatedAt: "2026-11-21",
    summary:
      "Independent sentiment data caught Claude grumbling on March 26, the day Anthropic shipped the cache bug. 28 days before the postmortem.",
    author: "David Kelly",
    tags: ["claude", "anthropic", "postmortem", "incident", "case-study"],
    relatedModelSlug: "claude",
    ogImage: "/research/claude-april-2026/og.png",
    dataset: {
      label: "Daily LLM Vibes scores · Mar 8 – Apr 24, 2026 (CSV)",
      path: "/research/claude-april-2026/data.csv",
      description:
        "Daily sentiment score (0–100) per tracked model with positive / negative / neutral counts and top-complaint label, from the first day of scraping. Source for every score in this analysis.",
      publishedAt: "2026-11-21",
      license: "MIT",
    },
  },
  {
    slug: "how-llm-vibes-classifies-sentiment",
    title: "How LLM Vibes classifies sentiment",
    publishedAt: "2026-04-25",
    updatedAt: "2026-11-21",
    summary:
      "How the pipeline goes from scraped post to daily score: five sources, one LLM grader, a fixed-mix 0–100 score that holds each source at its usual share, and the limitations I know about.",
    metaDescription:
      "How LLM Vibes scores sentiment about Claude, ChatGPT, Gemini and Grok: five sources, one LLM grader, a fixed-mix daily score, and its known limitations.",
    author: "David Kelly",
    tags: ["methodology"],
    ogImage: "/research/how-llm-vibes-classifies-sentiment/og.png",
  },
  {
    slug: "cross-model-deltas-march-april-2026",
    title: "On average, Claude outscored ChatGPT during its own regression. The change gave it away.",
    publishedAt: "2026-04-25",
    updatedAt: "2026-11-21",
    summary:
      "During the March 2026 cache bug, Claude averaged 48 and ChatGPT 32, so a side-by-side read said Claude was fine. Against each model's own six days before, Claude fell 11 points while ChatGPT rose 6. Compare a model with its own recent past, not with its neighbors.",
    metaDescription:
      "During Claude's March 2026 cache bug, Claude still outscored ChatGPT. Measured against each model's own week before, Claude fell 11 points and ChatGPT rose 6.",
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
