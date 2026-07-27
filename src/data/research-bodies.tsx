import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

/**
 * Slug -> body component lookup. Kept separate from `research-posts.ts`
 * so the metadata file stays JSX-free and the build-time RSS generator
 * can import it under plain Node without esbuild.
 *
 * Bodies are `lazy()`, not static imports. Two of these articles render
 * `ArticleSeriesChart`, which pulls in recharts (~386 KB raw / 106 KB gzip).
 * With static imports that chunk was in the module graph of the shared
 * ResearchPost route chunk, so it loaded on all six article URLs — including
 * the four that render no chart at all. Splitting per slug also stops every
 * article body from shipping in one ~116 KB chunk.
 *
 * The keys are static, so `getResearchBody(slug)` still returns undefined for
 * an unknown slug and ResearchPost's `!post || !Body` 404 check is unaffected.
 *
 * To add a new article: drop a `src/data/research/<slug>.tsx` exporting
 * a default component, register the metadata in `RESEARCH_POSTS`, and
 * register the body component here.
 */
export const RESEARCH_BODIES: Record<string, LazyExoticComponent<ComponentType>> = {
  "claude-april-2026": lazy(() => import("./research/claude-april-2026")),
  "how-llm-vibes-classifies-sentiment": lazy(
    () => import("./research/how-llm-vibes-classifies-sentiment"),
  ),
  "cross-model-deltas-march-april-2026": lazy(
    () => import("./research/cross-model-deltas-march-april-2026"),
  ),
  "surface-segmentation-march-may-2026": lazy(
    () => import("./research/surface-segmentation-march-may-2026"),
  ),
  "fable-5-lifecycle-june-july-2026": lazy(
    () => import("./research/fable-5-lifecycle-june-july-2026"),
  ),
  "grok-45-launch-july-2026": lazy(() => import("./research/grok-45-launch-july-2026")),
};

export function getResearchBody(slug: string): LazyExoticComponent<ComponentType> | undefined {
  return RESEARCH_BODIES[slug];
}
