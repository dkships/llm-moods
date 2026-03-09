CREATE TABLE public.scraper_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  source text NOT NULL,
  posts_found integer DEFAULT 0,
  posts_classified integer DEFAULT 0,
  errors text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'running'
);

ALTER TABLE public.scraper_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read scraper_runs" ON public.scraper_runs FOR SELECT USING (true);

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;