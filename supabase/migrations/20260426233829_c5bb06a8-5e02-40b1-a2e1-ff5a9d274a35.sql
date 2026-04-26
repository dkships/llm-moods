BEGIN;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY model_id, period, period_start ORDER BY created_at DESC
  ) AS rn
  FROM vibes_scores
)
DELETE FROM vibes_scores WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vibes_scores_model_period_start
  ON vibes_scores (model_id, period, period_start);

ALTER TABLE vibes_scores ADD COLUMN IF NOT EXISTS eligible_posts integer;

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

DELETE FROM model_keywords WHERE keyword = 'bard';

UPDATE model_keywords
SET context_words = 'xai,x.ai,elon musk,@grok,xai grok'
WHERE keyword = 'grok' AND tier = 'ambiguous';

COMMIT;