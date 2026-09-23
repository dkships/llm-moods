CREATE OR REPLACE FUNCTION public.get_trending_complaints()
 RETURNS TABLE(model_id uuid, model_name text, model_slug text, accent_color text, category text, this_week bigint, last_week bigint, pct_change integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH normalized_posts AS (
    SELECT sp.model_id,
           public.normalize_public_complaint_category(sp.complaint_category) AS category,
           sp.posted_at
    FROM scraped_posts sp
    WHERE sp.classification_status = 'classified'
      AND sp.complaint_category IS NOT NULL
      AND sp.posted_at >= (now() - interval '14 days')
  ),
  this_week AS (
    SELECT np.model_id, np.category, COUNT(*) AS cnt
    FROM normalized_posts np
    WHERE np.category IS NOT NULL AND np.posted_at >= (now() - interval '7 days')
    GROUP BY np.model_id, np.category HAVING COUNT(*) > 3
  ),
  last_week AS (
    SELECT np.model_id, np.category, COUNT(*) AS cnt
    FROM normalized_posts np
    WHERE np.category IS NOT NULL
      AND np.posted_at < (now() - interval '7 days')
    GROUP BY np.model_id, np.category
  ),
  model_totals AS (
    SELECT model_id, SUM(cnt) AS total FROM this_week GROUP BY model_id HAVING SUM(cnt) > 5
  )
  SELECT m.id, m.name, m.slug, m.accent_color, tw.category, tw.cnt,
         COALESCE(lw.cnt, 0),
         CASE WHEN COALESCE(lw.cnt,0)=0 THEN 100
              ELSE ((tw.cnt - COALESCE(lw.cnt,0))::numeric / GREATEST(COALESCE(lw.cnt,0),1) * 100)::integer END
  FROM this_week tw
  JOIN model_totals mt ON mt.model_id = tw.model_id
  JOIN models m ON m.id = tw.model_id
  LEFT JOIN last_week lw ON lw.model_id = tw.model_id AND lw.category = tw.category
  ORDER BY ABS(CASE WHEN COALESCE(lw.cnt,0)=0 THEN 100
                    ELSE ((tw.cnt - COALESCE(lw.cnt,0))::numeric / GREATEST(COALESCE(lw.cnt,0),1) * 100)::integer END) DESC;
$function$;

CREATE INDEX IF NOT EXISTS idx_scraped_posts_status_posted_at
  ON public.scraped_posts (classification_status, posted_at);