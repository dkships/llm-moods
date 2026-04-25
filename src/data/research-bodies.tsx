import type { ComponentType } from "react";

import ClaudeApril2026Body from "./research/claude-april-2026";
import HowLlmVibesClassifiesSentimentBody from "./research/how-llm-vibes-classifies-sentiment";
import CrossModelDeltasBody from "./research/cross-model-deltas-march-april-2026";

/**
 * Slug -> body component lookup. Kept separate from `research-posts.ts`
 * so the metadata file stays JSX-free and the build-time RSS generator
 * can import it under plain Node without esbuild.
 *
 * To add a new article: drop a `src/data/research/<slug>.tsx` exporting
 * a default component, register the metadata in `RESEARCH_POSTS`, and
 * register the body component here.
 */
export const RESEARCH_BODIES: Record<string, ComponentType> = {
  "claude-april-2026": ClaudeApril2026Body,
  "how-llm-vibes-classifies-sentiment": HowLlmVibesClassifiesSentimentBody,
  "cross-model-deltas-march-april-2026": CrossModelDeltasBody,
};

export function getResearchBody(slug: string): ComponentType | undefined {
  return RESEARCH_BODIES[slug];
}
