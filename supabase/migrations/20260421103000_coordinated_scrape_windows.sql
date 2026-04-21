ALTER TABLE public.scraper_runs
  ADD COLUMN IF NOT EXISTS run_kind text NOT NULL DEFAULT 'scraper',
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES public.scraper_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS triggered_by text,
  ADD COLUMN IF NOT EXISTS window_label text,
  ADD COLUMN IF NOT EXISTS window_local_date date,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS apify_items_fetched integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS filtered_candidates integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_new_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_conflicts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.scraper_runs
SET run_kind = 'scraper'
WHERE run_kind IS DISTINCT FROM 'scraper'
  AND source <> 'run-scrapers';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scraper_runs_status_check'
      AND conrelid = 'public.scraper_runs'::regclass
  ) THEN
    ALTER TABLE public.scraper_runs
      ADD CONSTRAINT scraper_runs_status_check
      CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scraper_runs_run_kind_check'
      AND conrelid = 'public.scraper_runs'::regclass
  ) THEN
    ALTER TABLE public.scraper_runs
      ADD CONSTRAINT scraper_runs_run_kind_check
      CHECK (run_kind IN ('scraper', 'orchestrator'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_scraper_runs_parent_run_id
  ON public.scraper_runs(parent_run_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scraper_runs_source_running
  ON public.scraper_runs(source)
  WHERE status = 'running';

CREATE UNIQUE INDEX IF NOT EXISTS uq_scraper_runs_orchestrator_window
  ON public.scraper_runs(source, window_local_date, window_label)
  WHERE run_kind = 'orchestrator'
    AND window_local_date IS NOT NULL
    AND window_label IS NOT NULL;

INSERT INTO public.scraper_config (scraper, key, value)
VALUES
  ('run-scrapers', 'timezone', 'America/Los_Angeles'),
  ('run-scrapers', 'window_time', '05:00'),
  ('run-scrapers', 'window_time', '14:00'),
  ('run-scrapers', 'window_time', '21:00'),
  ('scrape-reddit-apify', 'enabled', 'true'),
  ('scrape-reddit-apify', 'max_items', '40'),
  ('scrape-reddit-apify', 'max_post_count', '8'),
  ('scrape-reddit-apify', 'start_url', 'https://www.reddit.com/r/ClaudeAI/new/'),
  ('scrape-reddit-apify', 'start_url', 'https://www.reddit.com/r/ChatGPT/new/'),
  ('scrape-reddit-apify', 'start_url', 'https://www.reddit.com/r/LocalLLaMA/new/'),
  ('scrape-reddit-apify', 'start_url', 'https://www.reddit.com/r/GoogleGemini/new/'),
  ('scrape-reddit-apify', 'start_url', 'https://www.reddit.com/r/artificial/new/'),
  ('scrape-twitter', 'enabled', 'true'),
  ('scrape-twitter', 'max_items', '50'),
  ('scrape-twitter', 'sort_mode', 'Latest'),
  ('scrape-twitter', 'search_term', '("claude" OR "claude ai" OR "claude code" OR anthropic) lang:en -filter:retweets'),
  ('scrape-twitter', 'search_term', '("chatgpt" OR "chat gpt" OR "openai gpt" OR openai) lang:en -filter:retweets'),
  ('scrape-twitter', 'search_term', '("gemini" OR "google gemini" OR "gemini ai") lang:en -filter:retweets'),
  ('scrape-twitter', 'search_term', '("grok" OR "grok ai" OR "xai grok") lang:en -filter:retweets')
ON CONFLICT (scraper, key, value) DO NOTHING;

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
  ),
  latest_posts AS (
    SELECT model_id, MAX(created_at) AS last_updated
    FROM scraped_posts
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
    lp.last_updated
  FROM models m
  LEFT JOIN ranked r1 ON r1.model_id = m.id AND r1.rn = 1
  LEFT JOIN ranked r2 ON r2.model_id = m.id AND r2.rn = 2
  LEFT JOIN post_counts pc ON pc.model_id = m.id
  LEFT JOIN latest_posts lp ON lp.model_id = m.id
  ORDER BY m.name;
$$;

CREATE OR REPLACE FUNCTION public.get_scraper_monitor_runs(limit_count integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  source text,
  run_kind text,
  parent_run_id uuid,
  triggered_by text,
  window_label text,
  window_local_date date,
  timezone text,
  started_at timestamptz,
  completed_at timestamptz,
  status text,
  posts_found integer,
  posts_classified integer,
  apify_items_fetched integer,
  filtered_candidates integer,
  net_new_rows integer,
  duplicate_conflicts integer,
  errors text[],
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sr.id,
    sr.source,
    sr.run_kind,
    sr.parent_run_id,
    sr.triggered_by,
    sr.window_label,
    sr.window_local_date,
    sr.timezone,
    sr.started_at,
    sr.completed_at,
    sr.status,
    sr.posts_found,
    sr.posts_classified,
    sr.apify_items_fetched,
    sr.filtered_candidates,
    sr.net_new_rows,
    sr.duplicate_conflicts,
    sr.errors,
    sr.metadata
  FROM public.scraper_runs sr
  ORDER BY sr.started_at DESC
  LIMIT GREATEST(COALESCE(limit_count, 100), 1);
$$;

DO $migration$
DECLARE
  aggregate_job_id bigint;
  reaggregate_job_id bigint;
  nightly_job_0930_id bigint;
  nightly_job_1030_id bigint;
BEGIN
  SELECT jobid
  INTO aggregate_job_id
  FROM cron.job
  WHERE jobname = 'aggregate-vibes-hourly';

  IF aggregate_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(aggregate_job_id);
  END IF;

  SELECT jobid
  INTO reaggregate_job_id
  FROM cron.job
  WHERE jobname = 'reaggregate-vibes-daily';

  IF reaggregate_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(reaggregate_job_id);
  END IF;

  SELECT jobid
  INTO nightly_job_0930_id
  FROM cron.job
  WHERE jobname = 'run-scrapers-nightly-reaggregate-0930-utc';

  IF nightly_job_0930_id IS NOT NULL THEN
    PERFORM cron.unschedule(nightly_job_0930_id);
  END IF;

  SELECT jobid
  INTO nightly_job_1030_id
  FROM cron.job
  WHERE jobname = 'run-scrapers-nightly-reaggregate-1030-utc';

  IF nightly_job_1030_id IS NOT NULL THEN
    PERFORM cron.unschedule(nightly_job_1030_id);
  END IF;

  PERFORM cron.schedule(
    'run-scrapers-nightly-reaggregate-0930-utc',
    '30 9 * * *',
    $cron$
      SELECT
        net.http_post(
          url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/run-scrapers',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4'
          ),
          body := '{"maintenance":"reaggregate-vibes"}'::jsonb
        );
    $cron$
  );

  PERFORM cron.schedule(
    'run-scrapers-nightly-reaggregate-1030-utc',
    '30 10 * * *',
    $cron$
      SELECT
        net.http_post(
          url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/run-scrapers',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4'
          ),
          body := '{"maintenance":"reaggregate-vibes"}'::jsonb
        );
    $cron$
  );
END
$migration$;
