-- Update get_landing_vibes() to use 7-day rolling post count from scraped_posts
-- instead of the 24h snapshot from vibes_scores.total_posts
CREATE OR REPLACE FUNCTION public.get_landing_vibes()
RETURNS TABLE (
  model_id uuid,
  model_name text,
  model_slug text,
  accent_color text,
  latest_score integer,
  previous_score integer,
  total_posts integer,
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
      vs.top_complaint,
      vs.created_at,
      ROW_NUMBER() OVER (PARTITION BY vs.model_id ORDER BY vs.period_start DESC) AS rn
    FROM vibes_scores vs
    WHERE vs.period = 'daily'
      AND vs.period_start > (now() - interval '14 days')
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
    r1.top_complaint,
    r1.created_at AS last_updated
  FROM models m
  LEFT JOIN ranked r1 ON r1.model_id = m.id AND r1.rn = 1
  LEFT JOIN ranked r2 ON r2.model_id = m.id AND r2.rn = 2
  LEFT JOIN post_counts pc ON pc.model_id = m.id
  ORDER BY m.name;
$$;
