-- Coordinated scrape windows: orchestrator + window metrics on scraper_runs
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

-- Prevent duplicate orchestrator runs for the same Pacific local date + window
CREATE UNIQUE INDEX IF NOT EXISTS scraper_runs_orchestrator_window_uniq
  ON public.scraper_runs (source, window_label, window_local_date)
  WHERE run_kind = 'orchestrator' AND window_label IS NOT NULL AND window_local_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS scraper_runs_parent_idx ON public.scraper_runs (parent_run_id);
CREATE INDEX IF NOT EXISTS scraper_runs_window_idx ON public.scraper_runs (window_local_date, window_label);

-- RPC for the scraper monitor surfacing recent runs with derived columns
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
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
    COALESCE(sr.errors, '{}'::text[]) AS errors,
    COALESCE(sr.metadata, '{}'::jsonb) AS metadata,
    sr.started_at,
    sr.completed_at,
    CASE WHEN sr.completed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (sr.completed_at - sr.started_at))::numeric
      ELSE NULL END AS duration_seconds
  FROM public.scraper_runs sr
  ORDER BY sr.started_at DESC
  LIMIT GREATEST(1, COALESCE(limit_count, 100));
$$;

-- Update get_landing_vibes to use latest scraped_posts.created_at for last_updated
CREATE OR REPLACE FUNCTION public.get_landing_vibes()
 RETURNS TABLE(model_id uuid, model_name text, model_slug text, accent_color text, latest_score integer, previous_score integer, total_posts integer, top_complaint text, last_updated timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  ),
  latest_post AS (
    SELECT model_id, MAX(created_at) AS last_post_at
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
    r1.top_complaint,
    COALESCE(lp.last_post_at, r1.created_at) AS last_updated
  FROM models m
  LEFT JOIN ranked r1 ON r1.model_id = m.id AND r1.rn = 1
  LEFT JOIN ranked r2 ON r2.model_id = m.id AND r2.rn = 2
  LEFT JOIN post_counts pc ON pc.model_id = m.id
  LEFT JOIN latest_post lp ON lp.model_id = m.id
  ORDER BY m.name;
$function$;

-- Seed scraper_config rows for coordinated windows + scraper params (idempotent)
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'run-scrapers', 'timezone', 'America/Los_Angeles'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper='run-scrapers' AND key='timezone' AND value='America/Los_Angeles');

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'run-scrapers', 'window_time', v
FROM (VALUES ('05:00'),('14:00'),('21:00')) AS t(v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config WHERE scraper='run-scrapers' AND key='window_time' AND value=t.v
);

-- scrape-reddit-apify config
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'enabled', 'true'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper='scrape-reddit-apify' AND key='enabled');

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'max_items', '40'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper='scrape-reddit-apify' AND key='max_items');

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'max_post_count', '8'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper='scrape-reddit-apify' AND key='max_post_count');

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'start_url', v
FROM (VALUES
  ('https://www.reddit.com/r/ClaudeAI/new/'),
  ('https://www.reddit.com/r/ChatGPT/new/'),
  ('https://www.reddit.com/r/LocalLLaMA/new/'),
  ('https://www.reddit.com/r/GoogleGemini/new/'),
  ('https://www.reddit.com/r/artificial/new/')
) AS t(v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config WHERE scraper='scrape-reddit-apify' AND key='start_url' AND value=t.v
);

-- scrape-twitter config
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'enabled', 'true'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper='scrape-twitter' AND key='enabled');

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'max_items', '50'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper='scrape-twitter' AND key='max_items');

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'sort', 'Latest'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper='scrape-twitter' AND key='sort');

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term', v
FROM (VALUES
  ('ChatGPT OR GPT-5 OR OpenAI'),
  ('Claude OR Anthropic OR Sonnet OR Opus'),
  ('Gemini OR "Google AI"'),
  ('Grok OR xAI')
) AS t(v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config WHERE scraper='scrape-twitter' AND key='search_term' AND value=t.v
);