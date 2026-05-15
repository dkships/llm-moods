-- Split "queued" (pending+retry, drain will retry) from "failed" (max attempts exhausted, drain ignores).
--
-- Before this migration, vibes_scores.queued_posts and get_landing_vibes.pending_classifications
-- both counted pending + retry + failed, while drain-classification-queue only processed
-- pending + retry. Failed posts were invisible to the drain but rendered as "queued" in the UI,
-- inflating partial-coverage warnings on chart days that could never self-heal.
--
-- After this migration:
--   * queued_posts = pending + retry  (work the drain will still attempt)
--   * failed_posts = failed           (max attempts exhausted, surfaced as "abandoned")
--   * classification_coverage = classified / (classified + pending + retry)
--     so coverage auto-heals when reclassify-posts?mode=reset_failed moves failed back to pending.
--   * unclassified_posts = pending + retry + failed  (the genuinely-not-scored union)

ALTER TABLE public.vibes_scores
  ADD COLUMN IF NOT EXISTS failed_posts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.vibes_scores.queued_posts IS
  'pending + retry posts the drain will still attempt';
COMMENT ON COLUMN public.vibes_scores.failed_posts IS
  'failed posts (max attempts exhausted) the drain ignores; surfaced as "abandoned" in UI';
COMMENT ON COLUMN public.vibes_scores.unclassified_posts IS
  'pending + retry + failed posts (the genuinely-not-scored union)';
COMMENT ON COLUMN public.vibes_scores.classification_coverage IS
  'classified / (classified + pending + retry); excludes failed so coverage heals after reset_failed';

-- Backfill the last 14 days so historical chart tooltips stop showing "queued" for failed posts.
-- Older rows can stay as-is; charts only render trailing 30d and the 7d window dominates.
WITH day_status AS (
  SELECT
    sp.model_id,
    date_trunc('day', sp.posted_at AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' AS period_start,
    COUNT(*) FILTER (WHERE sp.classification_status = 'classified')::integer AS classified,
    COUNT(*) FILTER (WHERE sp.classification_status IN ('pending', 'retry'))::integer AS queued,
    COUNT(*) FILTER (WHERE sp.classification_status = 'failed')::integer AS failed_n
  FROM public.scraped_posts sp
  WHERE sp.posted_at > (now() - interval '14 days')
  GROUP BY sp.model_id, period_start
)
UPDATE public.vibes_scores vs
SET
  queued_posts = ds.queued,
  failed_posts = ds.failed_n,
  unclassified_posts = ds.queued + ds.failed_n,
  classification_coverage = CASE
    WHEN ds.classified + ds.queued <= 0 THEN 1.0
    ELSE LEAST(1.0, GREATEST(0.0, ds.classified::numeric / (ds.classified + ds.queued)))
  END
FROM day_status ds
WHERE vs.model_id = ds.model_id
  AND vs.period = 'daily'
  AND vs.period_start = ds.period_start;

-- Update get_landing_vibes to expose failed_classifications and to count
-- pending_classifications strictly as pending + retry (not failed).
DROP FUNCTION IF EXISTS public.get_landing_vibes();
CREATE OR REPLACE FUNCTION public.get_landing_vibes()
RETURNS TABLE(
  model_id uuid, model_name text, model_slug text, accent_color text,
  latest_score integer, previous_score integer, total_posts integer, top_complaint text,
  eligible_posts integer, last_updated timestamptz, score_computed_at timestamptz,
  score_period_start timestamptz, score_period_end timestamptz,
  latest_score_total_posts integer, latest_score_eligible_posts integer,
  recent_posts_7d integer, latest_post_posted_at timestamptz, latest_post_ingested_at timestamptz,
  score_basis_status text, measurement_period_start timestamptz, carried_from_period_start timestamptz,
  queued_posts integer, unclassified_posts integer, classification_coverage numeric,
  score_confidence text, latest_measurement_period_start timestamptz, is_stale boolean,
  pending_classifications integer,
  failed_posts integer, failed_classifications integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH current_day AS (
    SELECT date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' AS starts_at
  ),
  ranked AS (
    SELECT vs.model_id, vs.score, vs.total_posts, vs.eligible_posts, vs.top_complaint,
           vs.period_start, vs.score_computed_at, vs.score_basis_status,
           COALESCE(vs.measurement_period_start, vs.period_start) AS measurement_period_start,
           vs.carried_from_period_start, vs.queued_posts, vs.unclassified_posts, vs.failed_posts,
           vs.classification_coverage, vs.score_confidence,
           ROW_NUMBER() OVER (PARTITION BY vs.model_id ORDER BY vs.period_start DESC) AS rn
    FROM public.vibes_scores vs
    WHERE vs.period = 'daily'
      AND vs.period_start > (now() - interval '90 days')
      AND COALESCE(vs.score_basis_status, 'measured') <> 'carried_forward'
      AND COALESCE(vs.eligible_posts, 0) > 0
  ),
  recent_posts AS (
    SELECT model_id, COUNT(*)::integer AS recent_posts_7d,
           MAX(posted_at) AS latest_post_posted_at, MAX(created_at) AS latest_post_ingested_at
    FROM public.scraped_posts
    WHERE posted_at > (now() - interval '7 days') AND classification_status <> 'irrelevant'
    GROUP BY model_id
  ),
  pending_posts AS (
    SELECT
      model_id,
      COUNT(*) FILTER (WHERE classification_status IN ('pending', 'retry'))::integer AS pending_classifications,
      COUNT(*) FILTER (WHERE classification_status = 'failed')::integer AS failed_classifications
    FROM public.scraped_posts
    WHERE posted_at > (now() - interval '7 days')
      AND classification_status IN ('pending','retry','failed')
    GROUP BY model_id
  )
  SELECT m.id, m.name, m.slug, m.accent_color,
         COALESCE(r1.score, 50), r2.score, COALESCE(rp.recent_posts_7d, 0),
         r1.top_complaint, COALESCE(r1.eligible_posts, 0), r1.score_computed_at,
         r1.score_computed_at, r1.period_start,
         CASE WHEN r1.period_start IS NOT NULL THEN r1.period_start + interval '1 day' ELSE NULL END,
         COALESCE(r1.total_posts, 0), COALESCE(r1.eligible_posts, 0),
         COALESCE(rp.recent_posts_7d, 0), rp.latest_post_posted_at, rp.latest_post_ingested_at,
         COALESCE(r1.score_basis_status, 'stale_no_current_score'),
         r1.measurement_period_start, r1.carried_from_period_start,
         COALESCE(r1.queued_posts, 0), COALESCE(r1.unclassified_posts, 0),
         COALESCE(r1.classification_coverage, 1.0), COALESCE(r1.score_confidence, 'low'),
         r1.measurement_period_start,
         (r1.period_start IS NULL OR r1.period_start < current_day.starts_at),
         COALESCE(pp.pending_classifications, 0),
         COALESCE(r1.failed_posts, 0),
         COALESCE(pp.failed_classifications, 0)
  FROM public.models m
  CROSS JOIN current_day
  LEFT JOIN ranked r1 ON r1.model_id = m.id AND r1.rn = 1
  LEFT JOIN ranked r2 ON r2.model_id = m.id AND r2.rn = 2
  LEFT JOIN recent_posts rp ON rp.model_id = m.id
  LEFT JOIN pending_posts pp ON pp.model_id = m.id
  ORDER BY m.name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_landing_vibes() TO anon, authenticated;
