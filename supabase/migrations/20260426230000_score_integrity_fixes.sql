-- Score-integrity fixes (audit pass, Apr 2026):
--   a) De-dup vibes_scores rows on the natural key (none exist today, but the
--      check-then-insert/update path in aggregate-vibes / reaggregate-vibes
--      is racy — a backfill landing while the hourly cron fires can produce
--      two rows for the same (model, period, period_start)).
--   b) Lock the natural key with a UNIQUE index. Lets us flip the upsert
--      payload to ON CONFLICT in the edge functions.
--   c) Persist `eligible_posts` (computed in vibes-scoring.ts but stripped
--      from the upsert payload today). Lets the dashboard render a 3-tier
--      confidence chip per model so a 1-post day doesn't look identical to
--      a 100-post day.
--   d) Align get_landing_vibes() windows. Currently the score lookback is
--      14 days while the post count is 7 days, so a stale carry-forward
--      score appears next to a fresh post total. Both windows → 7 days.
--      Also returns eligible_posts for the chip.
--   e) Drop the 'bard' high-tier keyword. Bard was renamed to Gemini in
--      Feb 2024; matching legacy Bard mentions against current Gemini
--      sentiment pollutes the signal.
--   f) Tighten the 'grok' ambiguous context_words. The current list
--      ("ai,llm,model,xai,elon,chatbot,musk,token") matches almost any
--      tech post — five of eight terms are too generic. Restrict to
--      xAI-distinctive markers.

BEGIN;

-- a) De-dupe (no-op if there are none, idempotent).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY model_id, period, period_start ORDER BY created_at DESC
  ) AS rn
  FROM vibes_scores
)
DELETE FROM vibes_scores WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- b) Lock the natural key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vibes_scores_model_period_start
  ON vibes_scores (model_id, period, period_start);

-- c) Persist eligible-post count. Backfilled by reaggregate-vibes after the
--    edge-function update lands; null is safe in the meantime (frontend
--    coerces null → 0 → "Preliminary").
ALTER TABLE vibes_scores ADD COLUMN IF NOT EXISTS eligible_posts integer;

-- d) Align get_landing_vibes windows + return eligible_posts.
--    DROP first because the return shape changes (eligible_posts column
--    added) and CREATE OR REPLACE rejects return-type changes in Postgres.
DROP FUNCTION IF EXISTS public.get_landing_vibes();

CREATE FUNCTION public.get_landing_vibes()
RETURNS TABLE (
  model_id uuid,
  model_name text,
  model_slug text,
  accent_color text,
  latest_score integer,
  previous_score integer,
  total_posts integer,
  eligible_posts integer,
  top_complaint text,
  last_updated timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      vs.model_id,
      vs.score,
      vs.total_posts,
      vs.eligible_posts,
      vs.top_complaint,
      vs.created_at,
      ROW_NUMBER() OVER (PARTITION BY vs.model_id ORDER BY vs.period_start DESC) AS rn
    FROM vibes_scores vs
    WHERE vs.period = 'daily'
      AND vs.period_start > (now() - interval '7 days')
  ),
  post_counts AS (
    SELECT model_id, COUNT(*)::integer AS total_posts
    FROM scraped_posts
    WHERE posted_at > (now() - interval '7 days')
    GROUP BY model_id
  )
  SELECT
    m.id AS model_id,
    m.name AS model_name,
    m.slug AS model_slug,
    m.accent_color,
    COALESCE(r1.score, 50) AS latest_score,
    r2.score AS previous_score,
    COALESCE(pc.total_posts, 0) AS total_posts,
    COALESCE(r1.eligible_posts, 0) AS eligible_posts,
    r1.top_complaint,
    r1.created_at AS last_updated
  FROM models m
  LEFT JOIN ranked r1 ON r1.model_id = m.id AND r1.rn = 1
  LEFT JOIN ranked r2 ON r2.model_id = m.id AND r2.rn = 2
  LEFT JOIN post_counts pc ON pc.model_id = m.id
  ORDER BY m.name;
$$;

-- e) Drop deprecated 'bard' keyword (high tier, mapped to Gemini).
DELETE FROM model_keywords WHERE keyword = 'bard';

-- f) Tighten 'grok' ambiguous disambiguation.
UPDATE model_keywords
SET context_words = 'xai,x.ai,elon musk,@grok,xai grok'
WHERE keyword = 'grok' AND tier = 'ambiguous';

COMMIT;
