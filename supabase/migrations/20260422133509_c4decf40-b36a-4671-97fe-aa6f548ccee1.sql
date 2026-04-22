
-- Revoke public read on sensitive operational tables.
-- The ScraperMonitor UI reads via get_scraper_monitor_runs() (SECURITY DEFINER), so it continues to work.

DROP POLICY IF EXISTS "Anyone can read error_log" ON public.error_log;
DROP POLICY IF EXISTS "Anyone can read scraper_config" ON public.scraper_config;
DROP POLICY IF EXISTS "Anyone can read scraper_runs" ON public.scraper_runs;

-- RLS stays enabled; with no policies, anon/authenticated cannot SELECT.
-- Service role bypasses RLS so edge functions continue to work.
