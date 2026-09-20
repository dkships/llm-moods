-- Headline score: skip today's row while it is still thin.
--
-- Daily rows are Pacific calendar days. At noon PT the current day for a
-- lower-volume model (Grok) often holds 1-3 eligible posts, and
-- get_landing_vibes used to make that the headline: the dashboard read
-- "19 · bad vibes · low sample" off a single post, then swung 20 points by
-- evening. The score is real; the day is not finished.
--
-- Change: while today's row is `thin_sample` (eligible_posts < min_posts),
-- the headline falls back to the most recent settled day. `is_stale` moves
-- with it — a headline from yesterday is expected, so staleness now means
-- "older than yesterday". Return shape is unchanged; the chart still shows
-- today's provisional point (dashed tail) from vibes_scores directly.
CREATE OR REPLACE FUNCTION public.get_landing_vibes()
 RETURNS TABLE(model_id uuid, model_name text, model_slug text, accent_color text, latest_score integer, previous_score integer, total_posts integer, top_complaint text, eligible_posts integer, last_updated timestamp with time zone, score_computed_at timestamp with time zone, score_period_start timestamp with time zone, score_period_end timestamp with time zone, latest_score_total_posts integer, latest_score_eligible_posts integer, recent_posts_7d integer, latest_post_posted_at timestamp with time zone, latest_post_ingested_at timestamp with time zone, score_basis_status text, measurement_period_start timestamp with time zone, carried_from_period_start timestamp with time zone, queued_posts integer, unclassified_posts integer, classification_coverage numeric, score_confidence text, latest_measurement_period_start timestamp with time zone, is_stale boolean, pending_classifications integer, failed_posts integer, failed_classifications integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
    CROSS JOIN current_day
    WHERE vs.period = 'daily'
      AND vs.period_start > (now() - interval '90 days')
      AND COALESCE(vs.score_basis_status, 'measured') <> 'carried_forward'
      AND COALESCE(vs.eligible_posts, 0) > 0
      -- Today's row is provisional while thin: let yesterday's settled score lead.
      AND NOT (
        vs.period_start >= current_day.starts_at
        AND COALESCE(vs.score_basis_status, 'measured') = 'thin_sample'
      )
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
         -- A headline from yesterday is the expected fallback; stale means older than that.
         (r1.period_start IS NULL OR r1.period_start < current_day.starts_at - interval '1 day'),
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
