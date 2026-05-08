-- Simplified pipeline rebuild:
-- - scraped_posts is now the model-mention classification work table.
-- - classification_queue is left dormant after migrating pending work.
-- - public vibes expose stale measured-score state instead of current-day carry-forward rows.

ALTER TABLE public.scraped_posts
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'classified',
  ADD COLUMN IF NOT EXISTS classification_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_classification_at timestamptz,
  ADD COLUMN IF NOT EXISTS classified_at timestamptz,
  ADD COLUMN IF NOT EXISTS classifier_version text,
  ADD COLUMN IF NOT EXISTS last_classification_error text;

ALTER TABLE public.scraped_posts
  DROP CONSTRAINT IF EXISTS scraped_posts_classification_status_check;

ALTER TABLE public.scraped_posts
  ADD CONSTRAINT scraped_posts_classification_status_check
  CHECK (classification_status IN ('pending', 'retry', 'classified', 'irrelevant', 'failed'));

UPDATE public.scraped_posts
SET
  classification_status = CASE
    WHEN sentiment IS NULL THEN 'irrelevant'
    ELSE 'classified'
  END,
  classified_at = COALESCE(classified_at, created_at, now()),
  classifier_version = COALESCE(classifier_version, 'legacy-inline-v1')
WHERE classifier_version IS NULL
  AND classification_status = 'classified';

CREATE INDEX IF NOT EXISTS idx_scraped_posts_classification_status_next
  ON public.scraped_posts(classification_status, next_classification_at, created_at);

CREATE INDEX IF NOT EXISTS idx_scraped_posts_model_classified_posted_at
  ON public.scraped_posts(model_id, classification_status, posted_at DESC);

INSERT INTO public.scraped_posts (
  model_id,
  source,
  source_url,
  title,
  content,
  content_type,
  score,
  posted_at,
  classification_status,
  classification_attempts,
  next_classification_at,
  last_classification_error,
  created_at
)
SELECT
  cq.model_id,
  cq.source,
  cq.source_url,
  cq.title,
  COALESCE(cq.content, cq.full_text, cq.title),
  cq.content_type,
  cq.score,
  cq.posted_at,
  'pending',
  cq.attempt_count,
  COALESCE(cq.next_attempt_at, now()),
  cq.last_error,
  cq.created_at
FROM public.classification_queue cq
WHERE cq.status IN ('queued', 'retrying', 'failed')
ON CONFLICT (source_url, model_id) DO UPDATE
SET
  classification_status = 'pending',
  classification_attempts = GREATEST(public.scraped_posts.classification_attempts, EXCLUDED.classification_attempts),
  next_classification_at = LEAST(
    COALESCE(public.scraped_posts.next_classification_at, EXCLUDED.next_classification_at),
    EXCLUDED.next_classification_at
  ),
  last_classification_error = COALESCE(public.scraped_posts.last_classification_error, EXCLUDED.last_classification_error)
WHERE public.scraped_posts.classification_status <> 'classified';

CREATE OR REPLACE FUNCTION public.get_classification_queue_health()
RETURNS TABLE(
  queued integer,
  retrying integer,
  failed integer,
  oldest_queued_at timestamptz,
  next_attempt_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(*) FILTER (WHERE classification_status = 'pending')::integer AS queued,
    COUNT(*) FILTER (WHERE classification_status = 'retry')::integer AS retrying,
    COUNT(*) FILTER (WHERE classification_status = 'failed')::integer AS failed,
    MIN(created_at) FILTER (WHERE classification_status IN ('pending', 'retry')) AS oldest_queued_at,
    MIN(next_classification_at) FILTER (WHERE classification_status IN ('pending', 'retry')) AS next_attempt_at
  FROM public.scraped_posts;
$function$;

GRANT EXECUTE ON FUNCTION public.get_classification_queue_health() TO anon, authenticated;

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
      AND classification_status = 'classified'
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
    AND classification_status = 'classified'
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
    WHERE sp.classification_status = 'classified'
      AND sp.complaint_category IS NOT NULL
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

DROP FUNCTION IF EXISTS public.get_landing_vibes();
CREATE OR REPLACE FUNCTION public.get_landing_vibes()
RETURNS TABLE(
  model_id uuid,
  model_name text,
  model_slug text,
  accent_color text,
  latest_score integer,
  previous_score integer,
  total_posts integer,
  top_complaint text,
  eligible_posts integer,
  last_updated timestamptz,
  score_computed_at timestamptz,
  score_period_start timestamptz,
  score_period_end timestamptz,
  latest_score_total_posts integer,
  latest_score_eligible_posts integer,
  recent_posts_7d integer,
  latest_post_posted_at timestamptz,
  latest_post_ingested_at timestamptz,
  score_basis_status text,
  measurement_period_start timestamptz,
  carried_from_period_start timestamptz,
  queued_posts integer,
  unclassified_posts integer,
  classification_coverage numeric,
  score_confidence text,
  latest_measurement_period_start timestamptz,
  is_stale boolean,
  pending_classifications integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH current_day AS (
    SELECT date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' AS starts_at
  ),
  ranked AS (
    SELECT
      vs.model_id,
      vs.score,
      vs.total_posts,
      vs.eligible_posts,
      vs.top_complaint,
      vs.period_start,
      vs.score_computed_at,
      vs.score_basis_status,
      COALESCE(vs.measurement_period_start, vs.period_start) AS measurement_period_start,
      vs.carried_from_period_start,
      vs.queued_posts,
      vs.unclassified_posts,
      vs.classification_coverage,
      vs.score_confidence,
      ROW_NUMBER() OVER (PARTITION BY vs.model_id ORDER BY vs.period_start DESC) AS rn
    FROM public.vibes_scores vs
    WHERE vs.period = 'daily'
      AND vs.period_start > (now() - interval '90 days')
      AND COALESCE(vs.score_basis_status, 'measured') <> 'carried_forward'
      AND COALESCE(vs.eligible_posts, 0) > 0
  ),
  recent_posts AS (
    SELECT
      model_id,
      COUNT(*)::integer AS recent_posts_7d,
      MAX(posted_at) AS latest_post_posted_at,
      MAX(created_at) AS latest_post_ingested_at
    FROM public.scraped_posts
    WHERE posted_at > (now() - interval '7 days')
      AND classification_status <> 'irrelevant'
    GROUP BY model_id
  ),
  pending_posts AS (
    SELECT
      model_id,
      COUNT(*)::integer AS pending_classifications
    FROM public.scraped_posts
    WHERE posted_at > (now() - interval '7 days')
      AND classification_status IN ('pending', 'retry', 'failed')
    GROUP BY model_id
  )
  SELECT
    m.id AS model_id,
    m.name AS model_name,
    m.slug AS model_slug,
    m.accent_color,
    COALESCE(r1.score, 50) AS latest_score,
    r2.score AS previous_score,
    COALESCE(rp.recent_posts_7d, 0) AS total_posts,
    r1.top_complaint,
    COALESCE(r1.eligible_posts, 0) AS eligible_posts,
    r1.score_computed_at AS last_updated,
    r1.score_computed_at,
    r1.period_start AS score_period_start,
    CASE WHEN r1.period_start IS NOT NULL THEN r1.period_start + interval '1 day' ELSE NULL END AS score_period_end,
    COALESCE(r1.total_posts, 0) AS latest_score_total_posts,
    COALESCE(r1.eligible_posts, 0) AS latest_score_eligible_posts,
    COALESCE(rp.recent_posts_7d, 0) AS recent_posts_7d,
    rp.latest_post_posted_at,
    rp.latest_post_ingested_at,
    COALESCE(r1.score_basis_status, 'stale_no_current_score') AS score_basis_status,
    r1.measurement_period_start,
    r1.carried_from_period_start,
    COALESCE(r1.queued_posts, 0) AS queued_posts,
    COALESCE(r1.unclassified_posts, 0) AS unclassified_posts,
    COALESCE(r1.classification_coverage, 1.0) AS classification_coverage,
    COALESCE(r1.score_confidence, 'low') AS score_confidence,
    r1.measurement_period_start AS latest_measurement_period_start,
    (r1.period_start IS NULL OR r1.period_start < current_day.starts_at) AS is_stale,
    COALESCE(pp.pending_classifications, 0) AS pending_classifications
  FROM public.models m
  CROSS JOIN current_day
  LEFT JOIN ranked r1 ON r1.model_id = m.id AND r1.rn = 1
  LEFT JOIN ranked r2 ON r2.model_id = m.id AND r2.rn = 2
  LEFT JOIN recent_posts rp ON rp.model_id = m.id
  LEFT JOIN pending_posts pp ON pp.model_id = m.id
  ORDER BY m.name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_landing_vibes() TO anon, authenticated;

INSERT INTO public.scraper_config (scraper, key, value)
VALUES
  ('run-pipeline', 'timezone', 'America/Los_Angeles'),
  ('run-pipeline', 'window_time', '05:00'),
  ('run-pipeline', 'window_time', '14:00'),
  ('run-pipeline', 'window_time', '21:00')
ON CONFLICT (scraper, key, value) DO NOTHING;

DO $migration$
DECLARE
  job_id bigint;
  anon_token text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4';
BEGIN
  FOR job_id IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'run-scrapers-hourly',
      'run-scrapers-hackernews-hourly',
      'run-scrapers-bluesky-hourly',
      'run-scrapers-mastodon-hourly',
      'run-scrapers-twitter-hourly',
      'run-scrapers-reddit-hourly',
      'aggregate-vibes-hourly',
      'reaggregate-vibes-recent',
      'run-scrapers-nightly-reaggregate-0930-utc',
      'run-scrapers-nightly-reaggregate-1030-utc',
      'run-pipeline-3x-daily',
      'drain-classification-queue',
      'drain-queue-trigger'
    )
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  PERFORM cron.schedule(
    'run-pipeline-3x-daily',
    '0 4,12,21 * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/run-pipeline',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"run-pipeline"}'::jsonb
      );
    $cron$, anon_token)
  );
END
$migration$;
