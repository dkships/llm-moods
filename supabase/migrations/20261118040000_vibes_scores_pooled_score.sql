-- Fixed-mix daily score (2026-11-17): vibes_scores.score is now each model's
-- sources held at their usual share (trailing 28 days) and measured against
-- their usual level (_shared/vibes-scoring.ts computeFixedMixScore). The old
-- pooled score of the same posts is kept beside it for comparison and audit.
-- NULL on rows written before the change. Public RPCs return explicit
-- columns, so nothing new is exposed.
-- Applied to production 2026-11-17 via query_database, before the
-- aggregate-vibes / reaggregate-vibes deploy that writes it.

ALTER TABLE public.vibes_scores ADD COLUMN IF NOT EXISTS pooled_score integer;
