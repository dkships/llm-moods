-- Phase: reliability and cost controls for scraper/scoring freshness.
-- Private provider keys stay in Edge Function env. Cron continues to use the
-- existing anon-token pg_net pattern; child scrapers enforce service-role
-- internal access when they spend Gemini/Apify quota.

ALTER TABLE public.vibes_scores
  ADD COLUMN IF NOT EXISTS score_computed_at timestamptz,
  ADD COLUMN IF NOT EXISTS score_basis_status text NOT NULL DEFAULT 'measured',
  ADD COLUMN IF NOT EXISTS measurement_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS carried_from_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS input_max_posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS input_max_created_at timestamptz;

UPDATE public.vibes_scores
SET
  score_computed_at = COALESCE(score_computed_at, created_at, now()),
  score_basis_status = CASE
    WHEN total_posts = 0 THEN 'carried_forward'
    WHEN COALESCE(eligible_posts, 0) = 0 THEN 'no_eligible_posts'
    WHEN COALESCE(eligible_posts, 0) < 5 THEN 'thin_sample'
    ELSE 'measured'
  END,
  measurement_period_start = COALESCE(measurement_period_start, CASE WHEN total_posts > 0 THEN period_start ELSE NULL END),
  carried_from_period_start = COALESCE(carried_from_period_start, CASE WHEN total_posts = 0 THEN period_start ELSE NULL END)
WHERE score_computed_at IS NULL
   OR measurement_period_start IS NULL
   OR carried_from_period_start IS NULL
   OR score_basis_status = 'measured';

ALTER TABLE public.vibes_scores
  ALTER COLUMN score_computed_at SET DEFAULT now();

UPDATE public.vibes_scores
SET score_computed_at = COALESCE(score_computed_at, created_at, now())
WHERE score_computed_at IS NULL;

ALTER TABLE public.vibes_scores
  ALTER COLUMN score_computed_at SET NOT NULL;

DROP INDEX IF EXISTS public.uq_scraper_runs_orchestrator_window;
CREATE UNIQUE INDEX IF NOT EXISTS uq_scraper_runs_orchestrator_window
  ON public.scraper_runs(source, window_local_date, window_label)
  WHERE run_kind = 'orchestrator'
    AND status IN ('running', 'success', 'partial')
    AND window_local_date IS NOT NULL
    AND window_label IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scraped_posts_model_posted_at_desc
  ON public.scraped_posts(model_id, posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_scraped_posts_source_source_url
  ON public.scraped_posts(source, source_url)
  WHERE source_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vibes_scores_daily_model_period_start_desc
  ON public.vibes_scores(model_id, period_start DESC)
  WHERE period = 'daily';

CREATE INDEX IF NOT EXISTS idx_scraper_runs_started_at_desc
  ON public.scraper_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_log_created_at_desc
  ON public.error_log(created_at DESC);

CREATE TABLE IF NOT EXISTS public.service_locks (
  lock_key text PRIMARY KEY,
  owner text NOT NULL,
  locked_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_locks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_claim_service_lock(
  p_lock_key text,
  p_owner text,
  p_ttl_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_lock public.service_locks%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('service-lock:' || p_lock_key, 0));

  SELECT * INTO current_lock
  FROM public.service_locks
  WHERE lock_key = p_lock_key
  FOR UPDATE;

  IF FOUND AND current_lock.locked_until > now() THEN
    RETURN false;
  END IF;

  INSERT INTO public.service_locks (lock_key, owner, locked_until, updated_at)
  VALUES (p_lock_key, p_owner, now() + make_interval(secs => GREATEST(30, p_ttl_seconds)), now())
  ON CONFLICT (lock_key) DO UPDATE
  SET owner = EXCLUDED.owner,
      locked_until = EXCLUDED.locked_until,
      updated_at = now();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_service_lock(
  p_lock_key text,
  p_owner text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.service_locks
  WHERE lock_key = p_lock_key
    AND owner = p_owner;
END;
$$;

CREATE TABLE IF NOT EXISTS public.api_quota_usage (
  provider text NOT NULL,
  quota_key text NOT NULL,
  bucket_type text NOT NULL CHECK (bucket_type IN ('day', 'minute')),
  bucket_start timestamptz NOT NULL,
  used_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, quota_key, bucket_type, bucket_start)
);

ALTER TABLE public.api_quota_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_api_quota(
  p_provider text,
  p_quota_key text,
  p_daily_limit integer,
  p_minute_limit integer
)
RETURNS TABLE (allowed boolean, reason text, daily_used integer, minute_used integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_day_start timestamptz;
  v_minute_start timestamptz;
  v_daily_used integer;
  v_minute_used integer;
BEGIN
  IF p_daily_limit <= 0 OR p_minute_limit <= 0 THEN
    RETURN QUERY SELECT false, 'invalid_limit', 0, 0;
    RETURN;
  END IF;

  v_day_start := (((now() AT TIME ZONE 'America/Los_Angeles')::date)::timestamp AT TIME ZONE 'America/Los_Angeles');
  v_minute_start := date_trunc('minute', now());

  PERFORM pg_advisory_xact_lock(hashtextextended('api-quota:' || p_provider || ':' || p_quota_key, 0));

  INSERT INTO public.api_quota_usage (provider, quota_key, bucket_type, bucket_start)
  VALUES
    (p_provider, p_quota_key, 'day', v_day_start),
    (p_provider, p_quota_key, 'minute', v_minute_start)
  ON CONFLICT DO NOTHING;

  SELECT used_count INTO v_daily_used
  FROM public.api_quota_usage
  WHERE provider = p_provider
    AND quota_key = p_quota_key
    AND bucket_type = 'day'
    AND bucket_start = v_day_start
  FOR UPDATE;

  SELECT used_count INTO v_minute_used
  FROM public.api_quota_usage
  WHERE provider = p_provider
    AND quota_key = p_quota_key
    AND bucket_type = 'minute'
    AND bucket_start = v_minute_start
  FOR UPDATE;

  IF v_daily_used >= p_daily_limit THEN
    RETURN QUERY SELECT false, 'daily_limit', v_daily_used, v_minute_used;
    RETURN;
  END IF;

  IF v_minute_used >= p_minute_limit THEN
    RETURN QUERY SELECT false, 'minute_limit', v_daily_used, v_minute_used;
    RETURN;
  END IF;

  UPDATE public.api_quota_usage
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE provider = p_provider
    AND quota_key = p_quota_key
    AND bucket_type = 'day'
    AND bucket_start = v_day_start
  RETURNING used_count INTO v_daily_used;

  UPDATE public.api_quota_usage
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE provider = p_provider
    AND quota_key = p_quota_key
    AND bucket_type = 'minute'
    AND bucket_start = v_minute_start
  RETURNING used_count INTO v_minute_used;

  DELETE FROM public.api_quota_usage
  WHERE bucket_type = 'minute'
    AND bucket_start < now() - interval '2 days';

  RETURN QUERY SELECT true, 'ok', v_daily_used, v_minute_used;
END;
$$;

REVOKE ALL ON FUNCTION public.try_claim_service_lock(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_service_lock(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_api_quota(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_claim_service_lock(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_service_lock(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_api_quota(text, text, integer, integer) TO service_role;

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
  carried_from_period_start timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ranked AS (
    SELECT
      vs.model_id,
      vs.score,
      vs.total_posts,
      vs.eligible_posts,
      vs.top_complaint,
      vs.period_start,
      vs.score_computed_at,
      vs.score_basis_status,
      vs.measurement_period_start,
      vs.carried_from_period_start,
      ROW_NUMBER() OVER (PARTITION BY vs.model_id ORDER BY vs.period_start DESC) AS rn
    FROM vibes_scores vs
    WHERE vs.period = 'daily'
      AND vs.period_start > (now() - interval '14 days')
  ),
  recent_posts AS (
    SELECT
      model_id,
      COUNT(*)::integer AS recent_posts_7d,
      MAX(posted_at) AS latest_post_posted_at,
      MAX(created_at) AS latest_post_ingested_at
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
    r1.carried_from_period_start
  FROM models m
  LEFT JOIN ranked r1 ON r1.model_id = m.id AND r1.rn = 1
  LEFT JOIN ranked r2 ON r2.model_id = m.id AND r2.rn = 2
  LEFT JOIN recent_posts rp ON rp.model_id = m.id
  ORDER BY m.name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_landing_vibes() TO anon, authenticated;

-- Low-cost Apify defaults.
UPDATE public.scraper_config
SET value = '25'
WHERE scraper = 'scrape-reddit-apify'
  AND key = 'max_items';

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'max_items', '25'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'max_items'
);

DELETE FROM public.scraper_config
WHERE scraper = 'scrape-twitter'
  AND key IN ('search_term', 'sort');

INSERT INTO public.scraper_config (scraper, key, value)
VALUES
  ('scrape-twitter', 'sort_mode', 'Latest'),
  (
    'scrape-twitter',
    'search_term',
    '("claude" OR "claude ai" OR "claude code" OR anthropic OR "chatgpt" OR "chat gpt" OR "openai gpt" OR openai OR "gemini" OR "google gemini" OR "gemini ai" OR "grok" OR "grok ai" OR "xai grok") lang:en -filter:retweets'
  )
ON CONFLICT (scraper, key, value) DO NOTHING;

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'run-scrapers', 'window_time', v
FROM (VALUES ('05:00'), ('11:00'), ('14:00'), ('17:00'), ('21:00'), ('23:00')) AS t(v)
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
      'run-scrapers-nightly-reaggregate-1030-utc'
    )
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  PERFORM cron.schedule(
    'run-scrapers-hackernews-hourly',
    '0 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/run-scrapers',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{"source":"scrape-hackernews"}'::jsonb
      );
    $cron$, anon_token)
  );

  PERFORM cron.schedule(
    'run-scrapers-bluesky-hourly',
    '6 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/run-scrapers',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{"source":"scrape-bluesky"}'::jsonb
      );
    $cron$, anon_token)
  );

  PERFORM cron.schedule(
    'run-scrapers-mastodon-hourly',
    '12 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/run-scrapers',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{"source":"scrape-mastodon"}'::jsonb
      );
    $cron$, anon_token)
  );

  PERFORM cron.schedule(
    'run-scrapers-twitter-hourly',
    '18 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/run-scrapers',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{"source":"scrape-twitter"}'::jsonb
      );
    $cron$, anon_token)
  );

  PERFORM cron.schedule(
    'run-scrapers-reddit-hourly',
    '20 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/run-scrapers',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{"source":"scrape-reddit-apify"}'::jsonb
      );
    $cron$, anon_token)
  );

  PERFORM cron.schedule(
    'aggregate-vibes-hourly',
    '50 * * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/aggregate-vibes',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb
      );
    $cron$, anon_token)
  );
END
$migration$;
