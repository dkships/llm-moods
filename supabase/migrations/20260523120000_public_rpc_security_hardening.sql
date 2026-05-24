-- Public read hardening: move browser data access to explicit RPCs, redact
-- monitor surfaces, and reschedule service-role Edge Function cron calls with
-- explicit scheduler payloads before the functions enforce their new gates.

CREATE OR REPLACE FUNCTION public.safe_public_url(url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN url ~* '^https?://[^[:space:]<>"'']+$' THEN url
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.safe_public_url(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.safe_public_url(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_model_by_slug(p_slug text)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  accent_color text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.name, m.slug, m.accent_color
  FROM public.models m
  WHERE m.slug = p_slug
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_public_vibes_sparkline(days_back integer DEFAULT 10)
RETURNS TABLE (
  model_id uuid,
  period_start timestamptz,
  score integer,
  total_posts integer,
  eligible_posts integer,
  score_basis_status text,
  classification_coverage numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    vs.model_id,
    vs.period_start,
    vs.score,
    COALESCE(vs.total_posts, 0),
    COALESCE(vs.eligible_posts, 0),
    vs.score_basis_status,
    vs.classification_coverage
  FROM public.vibes_scores vs
  WHERE vs.period = 'daily'
    AND vs.period_start >= now() - (LEAST(GREATEST(COALESCE(days_back, 10), 1), 30) || ' days')::interval
  ORDER BY vs.period_start ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_public_vibes_history(
  p_model_id uuid,
  p_period text,
  p_since timestamptz,
  p_until timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 120
)
RETURNS TABLE (
  model_id uuid,
  period_start timestamptz,
  score integer,
  total_posts integer,
  eligible_posts integer,
  score_basis_status text,
  queued_posts integer,
  failed_posts integer,
  classification_coverage numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    vs.model_id,
    vs.period_start,
    vs.score,
    COALESCE(vs.total_posts, 0),
    COALESCE(vs.eligible_posts, 0),
    vs.score_basis_status,
    COALESCE(vs.queued_posts, 0),
    COALESCE(vs.failed_posts, 0),
    vs.classification_coverage
  FROM public.vibes_scores vs
  WHERE vs.model_id = p_model_id
    AND vs.period = CASE WHEN p_period IN ('daily', 'hourly') THEN p_period ELSE 'daily' END
    AND vs.period_start >= p_since
    AND (p_until IS NULL OR vs.period_start <= p_until)
  ORDER BY vs.period_start ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 120), 1), 240);
$$;

CREATE OR REPLACE FUNCTION public.get_public_recent_chatter(
  page_cursor timestamptz DEFAULT NULL,
  page_size integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  model_id uuid,
  model_name text,
  model_slug text,
  accent_color text,
  source text,
  source_url text,
  title text,
  content text,
  translated_content text,
  original_language text,
  posted_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sp.id,
    sp.model_id,
    m.name,
    m.slug,
    m.accent_color,
    sp.source,
    public.safe_public_url(sp.source_url),
    sp.title,
    sp.content,
    sp.translated_content,
    sp.original_language,
    sp.posted_at
  FROM public.scraped_posts sp
  JOIN public.models m ON m.id = sp.model_id
  WHERE sp.classification_status = 'classified'
    AND (page_cursor IS NULL OR sp.posted_at < page_cursor)
  ORDER BY sp.posted_at DESC
  LIMIT LEAST(GREATEST(COALESCE(page_size, 25), 1), 50);
$$;

CREATE OR REPLACE FUNCTION public.get_public_model_posts(
  p_model_id uuid,
  p_since timestamptz,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  model_id uuid,
  source text,
  source_url text,
  title text,
  content text,
  translated_content text,
  original_language text,
  posted_at timestamptz,
  sentiment text,
  complaint_category text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sp.id,
    sp.model_id,
    sp.source,
    public.safe_public_url(sp.source_url),
    sp.title,
    sp.content,
    sp.translated_content,
    sp.original_language,
    sp.posted_at,
    sp.sentiment,
    sp.complaint_category
  FROM public.scraped_posts sp
  WHERE sp.model_id = p_model_id
    AND sp.classification_status = 'classified'
    AND sp.posted_at >= p_since
  ORDER BY sp.posted_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
$$;

CREATE OR REPLACE FUNCTION public.get_public_score_anomaly_inputs(
  recent_days integer DEFAULT 30,
  lookback_days integer DEFAULT 14
)
RETURNS TABLE (
  model_id uuid,
  model_slug text,
  model_name text,
  accent_color text,
  score integer,
  period_start timestamptz,
  total_posts integer,
  eligible_posts integer,
  score_basis_status text,
  classification_coverage numeric,
  top_complaint text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    vs.model_id,
    m.slug,
    m.name,
    m.accent_color,
    vs.score,
    vs.period_start,
    COALESCE(vs.total_posts, 0),
    COALESCE(vs.eligible_posts, 0),
    vs.score_basis_status,
    vs.classification_coverage,
    vs.top_complaint
  FROM public.vibes_scores vs
  JOIN public.models m ON m.id = vs.model_id
  WHERE vs.period = 'daily'
    AND vs.period_start >= now() - (
      LEAST(GREATEST(COALESCE(recent_days, 30), 1), 90)
      + LEAST(GREATEST(COALESCE(lookback_days, 14), 1), 60)
      + 1
    ) * interval '1 day'
  ORDER BY vs.period_start ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_public_failed_classification_summary(days_back integer DEFAULT 14)
RETURNS TABLE (
  error_group text,
  count bigint,
  model_slugs text[],
  oldest_failed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH grouped AS (
    SELECT
      CASE
        WHEN sp.last_classification_error ILIKE '%quota%' THEN 'quota'
        WHEN sp.last_classification_error ILIKE '%timeout%' OR sp.last_classification_error ILIKE '%abort%' THEN 'timeout'
        WHEN sp.last_classification_error ILIKE '%parse%' OR sp.last_classification_error ILIKE '%json%' THEN 'parse'
        WHEN sp.last_classification_error ILIKE '%api%' OR sp.last_classification_error ILIKE '%fetch%' THEN 'api'
        WHEN sp.last_classification_error ILIKE '%transient%' THEN 'transient'
        ELSE 'other'
      END AS error_group,
      m.slug AS model_slug,
      sp.posted_at
    FROM public.scraped_posts sp
    JOIN public.models m ON m.id = sp.model_id
    WHERE sp.classification_status = 'failed'
      AND sp.posted_at >= now() - (LEAST(GREATEST(COALESCE(days_back, 14), 1), 90) || ' days')::interval
  )
  SELECT
    grouped.error_group,
    COUNT(*)::bigint,
    ARRAY_AGG(DISTINCT grouped.model_slug ORDER BY grouped.model_slug),
    MIN(grouped.posted_at)
  FROM grouped
  GROUP BY grouped.error_group
  ORDER BY COUNT(*) DESC, grouped.error_group
  LIMIT 10;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_model_by_slug(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_vibes_sparkline(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_vibes_history(uuid, text, timestamptz, timestamptz, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_recent_chatter(timestamptz, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_model_posts(uuid, timestamptz, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_score_anomaly_inputs(integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_failed_classification_summary(integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_recent_errors(hours_back integer DEFAULT 24)
RETURNS TABLE (
  function_name text,
  context text,
  error_count bigint,
  last_seen timestamptz,
  sample_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.function_name,
    COALESCE(e.context, 'unknown') AS context,
    COUNT(*)::bigint AS error_count,
    MAX(e.created_at) AS last_seen,
    NULL::text AS sample_message
  FROM public.error_log e
  WHERE e.created_at > now() - (LEAST(GREATEST(COALESCE(hours_back, 24), 1), 168) || ' hours')::interval
    AND e.error_message IS NOT NULL
    AND e.error_message NOT IN ('Function started')
    AND e.error_message NOT LIKE 'Successfully aggregated vibes%'
  GROUP BY e.function_name, COALESCE(e.context, 'unknown')
  ORDER BY error_count DESC, last_seen DESC
  LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_critical_alerts(hours_back integer DEFAULT 24)
RETURNS TABLE (
  id uuid,
  function_name text,
  error_message text,
  context text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.function_name,
    'Critical alert recorded'::text AS error_message,
    COALESCE(e.context, 'unknown') AS context,
    e.created_at
  FROM public.error_log e
  WHERE e.severity = 'critical'
    AND e.created_at > now() - (LEAST(GREATEST(COALESCE(hours_back, 24), 1), 168) || ' hours')::interval
  ORDER BY e.created_at DESC
  LIMIT 20;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_classification_queue_health()
RETURNS TABLE (
  queued integer,
  retrying integer,
  failed integer,
  oldest_queued_at timestamptz,
  next_attempt_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN pending_count = 0 THEN 0
      WHEN pending_count < 50 THEN 1
      WHEN pending_count < 500 THEN 50
      ELSE 500
    END::integer AS queued,
    CASE
      WHEN retry_count = 0 THEN 0
      WHEN retry_count < 50 THEN 1
      WHEN retry_count < 500 THEN 50
      ELSE 500
    END::integer AS retrying,
    CASE
      WHEN failed_count = 0 THEN 0
      WHEN failed_count < 50 THEN 1
      WHEN failed_count < 500 THEN 50
      ELSE 500
    END::integer AS failed,
    CASE WHEN pending_count + retry_count > 0 THEN oldest_pending_at ELSE NULL END AS oldest_queued_at,
    CASE WHEN pending_count + retry_count > 0 THEN next_pending_at ELSE NULL END AS next_attempt_at
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE classification_status = 'pending')::integer AS pending_count,
      COUNT(*) FILTER (WHERE classification_status = 'retry')::integer AS retry_count,
      COUNT(*) FILTER (WHERE classification_status = 'failed')::integer AS failed_count,
      MIN(created_at) FILTER (WHERE classification_status IN ('pending', 'retry')) AS oldest_pending_at,
      MIN(next_classification_at) FILTER (WHERE classification_status IN ('pending', 'retry')) AS next_pending_at
    FROM public.scraped_posts
  ) counts;
$$;

-- Keep the dev-only monitor usable without leaking raw operational messages.
CREATE OR REPLACE FUNCTION public.get_scraper_monitor_runs(limit_count integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  source text,
  status text,
  run_kind text,
  parent_run_id uuid,
  triggered_by text,
  window_label text,
  window_local_date date,
  timezone text,
  posts_found integer,
  posts_classified integer,
  apify_items_fetched integer,
  filtered_candidates integer,
  net_new_rows integer,
  duplicate_conflicts integer,
  errors text[],
  metadata jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sr.id,
    sr.source,
    sr.status,
    sr.run_kind,
    sr.parent_run_id,
    sr.triggered_by,
    sr.window_label,
    sr.window_local_date,
    sr.timezone,
    COALESCE(sr.posts_found, 0) AS posts_found,
    COALESCE(sr.posts_classified, 0) AS posts_classified,
    COALESCE(sr.apify_items_fetched, 0) AS apify_items_fetched,
    COALESCE(sr.filtered_candidates, 0) AS filtered_candidates,
    COALESCE(sr.net_new_rows, 0) AS net_new_rows,
    COALESCE(sr.duplicate_conflicts, 0) AS duplicate_conflicts,
    '{}'::text[] AS errors,
    jsonb_strip_nulls(jsonb_build_object(
      'classification_queued', sr.metadata->'classification_queued',
      'classifier_quota_deferred', sr.metadata->'classifier_quota_deferred'
    )) AS metadata,
    sr.started_at,
    sr.completed_at,
    CASE WHEN sr.completed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (sr.completed_at - sr.started_at))::numeric
      ELSE NULL END AS duration_seconds
  FROM public.scraper_runs sr
  ORDER BY sr.started_at DESC
  LIMIT LEAST(GREATEST(COALESCE(limit_count, 100), 1), 200);
$$;

DROP POLICY IF EXISTS "Anyone can read models" ON public.models;
DROP POLICY IF EXISTS "Anyone can read scraped_posts" ON public.scraped_posts;
DROP POLICY IF EXISTS "Anyone can read vibes_scores" ON public.vibes_scores;
DROP POLICY IF EXISTS "Anyone can read model_keywords" ON public.model_keywords;
DROP POLICY IF EXISTS "Anyone can read user_reports" ON public.user_reports;

DO $migration$
DECLARE
  job_id bigint;
  anon_token text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4';
  base_url text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1';
BEGIN
  FOR job_id IN
    SELECT jobid FROM cron.job WHERE jobname IN (
      'aggregate-vibes-hourly',
      'aggregate-vibes-q30',
      'cleanup-old-posts-weekly'
    )
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  PERFORM cron.schedule(
    'aggregate-vibes-q30',
    '20,50 * * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/aggregate-vibes',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"aggregate-vibes"}'::jsonb
      );
    $cron$, base_url, anon_token)
  );

  PERFORM cron.schedule(
    'cleanup-old-posts-weekly',
    '0 8 * * 0',
    format($cron$
      SELECT net.http_post(
        url := '%s/cleanup-old-posts',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"cleanup-old-posts"}'::jsonb
      );
    $cron$, base_url, anon_token)
  );
END
$migration$;
