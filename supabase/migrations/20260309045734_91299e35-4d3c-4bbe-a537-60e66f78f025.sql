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
  WITH this_week AS (
    SELECT sp.model_id, sp.complaint_category AS category, COUNT(*) AS cnt
    FROM scraped_posts sp
    WHERE sp.complaint_category IS NOT NULL
      AND sp.posted_at >= (now() - interval '7 days')
    GROUP BY sp.model_id, sp.complaint_category
    HAVING COUNT(*) > 3
  ),
  last_week AS (
    SELECT sp.model_id, sp.complaint_category AS category, COUNT(*) AS cnt
    FROM scraped_posts sp
    WHERE sp.complaint_category IS NOT NULL
      AND sp.posted_at >= (now() - interval '14 days')
      AND sp.posted_at < (now() - interval '7 days')
    GROUP BY sp.model_id, sp.complaint_category
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