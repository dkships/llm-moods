-- Phase 11C: restore the aggregate-vibes-hourly cron that was unscheduled
-- by 20260421103000_coordinated_scrape_windows.sql.
--
-- Why this is needed: the run-scrapers orchestrator was meant to call
-- aggregate-vibes after each scrape window finishes, replacing the hourly
-- cron. In practice the orchestrator hits the Supabase edge-function
-- wall-clock budget — 7/7 recent runs were marked "failed" by the
-- cleanup-stuck-scraper-runs cron with "auto-cleanup: status=running >
-- 30min". Children scrapers complete and write data, but aggregate-vibes
-- is never reached, so daily scores stay stale until the 02:30 PT nightly
-- reaggregate.
--
-- Restoring the hourly cron at HH:10 lands ~10 minutes after the hourly
-- scrape window starts. aggregate-vibes is idempotent (computes the same
-- result from the same inputs) so running it in parallel with whatever
-- the orchestrator is still attempting is safe. Net effect: today's
-- scores reflect today's posts within ~10 minutes of each scrape window.

DO $migration$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id FROM cron.job WHERE jobname = 'aggregate-vibes-hourly';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'aggregate-vibes-hourly',
    '10 * * * *',
    $cron$
      SELECT
        net.http_post(
          url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/aggregate-vibes',
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
