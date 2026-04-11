DROP POLICY IF EXISTS "Anyone can read error_log" ON public.error_log;
DROP POLICY IF EXISTS "Anyone can read scraper_runs" ON public.scraper_runs;

CREATE OR REPLACE FUNCTION public.normalize_public_complaint_category(p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_category IS NULL THEN NULL
    WHEN p_category = 'reliability' THEN 'api_reliability'
    WHEN p_category IN (
      'lazy_responses',
      'hallucinations',
      'refusals',
      'coding_quality',
      'speed',
      'general_drop',
      'pricing_value',
      'censorship',
      'context_window',
      'api_reliability',
      'multimodal_quality',
      'reasoning'
    ) THEN p_category
    ELSE NULL
  END
$$;

UPDATE public.scraped_posts
SET complaint_category = public.normalize_public_complaint_category(complaint_category)
WHERE complaint_category IS DISTINCT FROM public.normalize_public_complaint_category(complaint_category);

UPDATE public.vibes_scores
SET top_complaint = public.normalize_public_complaint_category(top_complaint)
WHERE top_complaint IS DISTINCT FROM public.normalize_public_complaint_category(top_complaint);

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
    public.normalize_public_complaint_category(r1.top_complaint) AS top_complaint,
    r1.created_at AS last_updated
  FROM models m
  LEFT JOIN ranked r1 ON r1.model_id = m.id AND r1.rn = 1
  LEFT JOIN ranked r2 ON r2.model_id = m.id AND r2.rn = 2
  LEFT JOIN post_counts pc ON pc.model_id = m.id
  ORDER BY m.name;
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
  SELECT
    normalized.category,
    COUNT(*) AS count
  FROM (
    SELECT public.normalize_public_complaint_category(complaint_category) AS category
    FROM scraped_posts
    WHERE model_id = p_model_id
      AND complaint_category IS NOT NULL
      AND posted_at > (now() - interval '30 days')
  ) normalized
  WHERE normalized.category IS NOT NULL
  GROUP BY normalized.category
  ORDER BY count DESC, normalized.category;
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
    AND posted_at > (now() - interval '30 days')
  GROUP BY source
  ORDER BY count DESC, source;
$$;

CREATE OR REPLACE FUNCTION public.get_trending_complaints()
RETURNS TABLE(
  model_id uuid,
  model_name text,
  model_slug text,
  accent_color text,
  category text,
  this_week bigint,
  last_week bigint,
  pct_change integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH normalized_posts AS (
    SELECT
      sp.model_id,
      public.normalize_public_complaint_category(sp.complaint_category) AS category,
      sp.posted_at
    FROM scraped_posts sp
    WHERE sp.complaint_category IS NOT NULL
  ),
  this_week AS (
    SELECT np.model_id, np.category, COUNT(*) AS cnt
    FROM normalized_posts np
    WHERE np.category IS NOT NULL
      AND np.posted_at >= (now() - interval '7 days')
    GROUP BY np.model_id, np.category
    HAVING COUNT(*) > 3
  ),
  last_week AS (
    SELECT np.model_id, np.category, COUNT(*) AS cnt
    FROM normalized_posts np
    WHERE np.category IS NOT NULL
      AND np.posted_at >= (now() - interval '14 days')
      AND np.posted_at < (now() - interval '7 days')
    GROUP BY np.model_id, np.category
  ),
  model_totals AS (
    SELECT model_id, SUM(cnt) AS total
    FROM this_week
    GROUP BY model_id
    HAVING SUM(cnt) > 5
  )
  SELECT
    m.id AS model_id,
    m.name AS model_name,
    m.slug AS model_slug,
    m.accent_color,
    tw.category,
    tw.cnt AS this_week,
    COALESCE(lw.cnt, 0) AS last_week,
    CASE WHEN COALESCE(lw.cnt, 0) = 0
      THEN 100
      ELSE ((tw.cnt - COALESCE(lw.cnt, 0))::numeric / GREATEST(COALESCE(lw.cnt, 0), 1) * 100)::integer
    END AS pct_change
  FROM this_week tw
  JOIN model_totals mt ON mt.model_id = tw.model_id
  JOIN models m ON m.id = tw.model_id
  LEFT JOIN last_week lw ON lw.model_id = tw.model_id AND lw.category = tw.category
  ORDER BY ABS(
    CASE WHEN COALESCE(lw.cnt, 0) = 0
      THEN 100
      ELSE ((tw.cnt - COALESCE(lw.cnt, 0))::numeric / GREATEST(COALESCE(lw.cnt, 0), 1) * 100)::integer
    END
  ) DESC;
$$;
