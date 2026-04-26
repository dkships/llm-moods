-- Phase 11B: schedule cleanup-old-posts weekly via pg_cron.
--
-- Without this, scraped_posts grows monotonically — the function deletes
-- posts older than 90 days and error_log entries older than 14 days, but
-- it was previously dormant (no caller, no cron). Running once a week is
-- sufficient: most days will delete a small batch, none will pile up
-- enough to matter.
--
-- Schedule: every Sunday at 08:00 UTC (= 01:00 PT during PDT). Picks a
-- low-traffic window that doesn't collide with the 05:00 / 14:00 / 21:00
-- PT scrape windows.

DO $migration$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id FROM cron.job WHERE jobname = 'cleanup-old-posts-weekly';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'cleanup-old-posts-weekly',
    '0 8 * * 0',
    $cron$
      SELECT
        net.http_post(
          url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/cleanup-old-posts',
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
