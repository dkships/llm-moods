-- Pipeline staleness watchdog.
--
-- Background: the May 2026 decomposition replaced the run-pipeline orchestrator
-- with 9 independent pg_cron rows. That fixed the 400 s edge-function ceiling
-- problem but left no global "is the pipeline alive?" check. A 36-hour silent
-- failure of run-pipeline went unnoticed before the rebuild; with 9 rows the
-- failure surface is wider, not narrower.
--
-- This migration:
--   1. Adds error_log.severity ('info' | 'warning' | 'critical') so the
--      watchdog can write critical rows that the UI can filter on.
--   2. Adds a btree index for the recency query the admin UI runs.
--   3. Schedules pipeline-watchdog-1h to call the new edge function hourly.
--
-- The watchdog is in-app only (no Slack / email). Critical rows surface as
-- a banner on /admin/scrapers and as a calm staleness banner on the public
-- dashboard when the most recent vibes_score is > 3 h old.

ALTER TABLE public.error_log
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'error_log_severity_check'
  ) THEN
    ALTER TABLE public.error_log
      ADD CONSTRAINT error_log_severity_check
      CHECK (severity IN ('info', 'warning', 'critical'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS error_log_severity_created_at_idx
  ON public.error_log (severity, created_at DESC);

-- Read API: latest critical-severity rows. SECURITY DEFINER so the dev-only
-- /admin/scrapers page can read them without granting anon SELECT on the full
-- error_log table (some rows contain raw error text we don't want public).
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
  SELECT e.id, e.function_name, e.error_message, e.context, e.created_at
  FROM public.error_log e
  WHERE e.severity = 'critical'
    AND e.created_at > now() - (hours_back || ' hours')::interval
  ORDER BY e.created_at DESC
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_critical_alerts(integer) TO anon, authenticated;

DO $migration$
DECLARE
  job_id bigint;
  anon_token text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4';
  base_url text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1';
BEGIN
  FOR job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'pipeline-watchdog-1h'
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  -- Fires at minute 25 to land between drain (:00/:15/:30/:45) and
  -- aggregate-vibes (:20/:50). That ordering means a watchdog tick reflects
  -- the freshest possible state of both queues.
  PERFORM cron.schedule(
    'pipeline-watchdog-1h', '25 * * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/pipeline-watchdog',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"pipeline-watchdog"}'::jsonb
      );
    $cron$, base_url, anon_token)
  );
END
$migration$;
