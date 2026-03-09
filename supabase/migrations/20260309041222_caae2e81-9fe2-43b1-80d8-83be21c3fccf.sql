
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
  )
  SELECT
    m.id AS model_id,
    m.name AS model_name,
    m.slug AS model_slug,
    m.accent_color,
    COALESCE(r1.score, 50) AS latest_score,
    r2.score AS previous_score,
    COALESCE(r1.total_posts, 0) AS total_posts,
    r1.top_complaint,
    r1.created_at AS last_updated
  FROM models m
  LEFT JOIN ranked r1 ON r1.model_id = m.id AND r1.rn = 1
  LEFT JOIN ranked r2 ON r2.model_id = m.id AND r2.rn = 2
  ORDER BY m.name;
$$;

CREATE OR REPLACE FUNCTION public.get_sparkline_scores()
RETURNS TABLE (
  model_id uuid,
  score integer,
  period_start timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT vs.model_id, vs.score, vs.period_start
  FROM (
    SELECT
      v.model_id, v.score, v.period_start,
      ROW_NUMBER() OVER (PARTITION BY v.model_id ORDER BY v.period_start DESC) AS rn
    FROM vibes_scores v
    WHERE v.period = 'daily'
      AND v.period_start > (now() - interval '10 days')
  ) vs
  WHERE vs.rn <= 7
  ORDER BY vs.model_id, vs.period_start ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_complaint_breakdown(p_model_id uuid)
RETURNS TABLE (
  category text,
  count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT complaint_category AS category, COUNT(*) AS count
  FROM scraped_posts
  WHERE model_id = p_model_id
    AND complaint_category IS NOT NULL
    AND posted_at > (now() - interval '30 days')
  GROUP BY complaint_category
  ORDER BY count DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_source_breakdown(p_model_id uuid)
RETURNS TABLE (
  source text,
  count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT source, COUNT(*) AS count
  FROM scraped_posts
  WHERE model_id = p_model_id
  GROUP BY source
  ORDER BY count DESC;
$$;
