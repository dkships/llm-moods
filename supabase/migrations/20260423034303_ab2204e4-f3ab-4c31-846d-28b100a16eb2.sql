-- Restore scrape scheduling for the coordinated-windows orchestrator that shipped
-- in 20260421103000_coordinated_scrape_windows.sql without a cron trigger.
-- One hourly cron POSTs an empty body to /run-scrapers. The orchestrator's own
-- getMatchingWindow() runs scrapers on the three UTC hours per day that land on
-- a configured Pacific window (05:00, 14:00, 21:00) and returns
-- {"status":"skipped","reason":"outside_window"} in ~ms for the other 21 hours.
-- Each Pacific window sits on a whole UTC hour in both DST and standard time,
-- so one hourly cron handles both seasons — no DST-specific rows needed.

DO $migration$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id FROM cron.job WHERE jobname = 'run-scrapers-hourly';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'run-scrapers-hourly',
    '0 * * * *',
    $cron$
      SELECT
        net.http_post(
          url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/run-scrapers',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4'
          ),
          body := '{}'::jsonb
        );
    $cron$
  );
END
$migration$;