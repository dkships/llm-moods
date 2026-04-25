-- cleanup-stuck-scraper-runs: every 30 minutes, mark any scraper_runs row
-- still in status='running' after 30+ minutes as 'failed' with an
-- auto-cleanup error annotation.
--
-- Belt-and-suspenders for the per-invocation timeout in run-scrapers
-- (Phase 9B-1). Catches cases where the function itself crashes or its
-- response handler fails to update the row. Without this, stuck rows
-- accumulate (today both 05:00 PDT and 14:00 PDT windows had hours-long
-- "running" rows that needed manual cleanup).
--
-- Runs as the database superuser (no service-role key needed).

DO $migration$
DECLARE
  existing_id bigint;
BEGIN
  SELECT jobid INTO existing_id FROM cron.job WHERE jobname = 'cleanup-stuck-scraper-runs';
  IF existing_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_id);
  END IF;

  PERFORM cron.schedule(
    'cleanup-stuck-scraper-runs',
    '*/30 * * * *',
    $cron$
      UPDATE public.scraper_runs
      SET status = 'failed',
          completed_at = now(),
          errors = COALESCE(errors, ARRAY[]::text[]) || ARRAY['auto-cleanup: status=running > 30min']
      WHERE status = 'running'
        AND started_at < now() - interval '30 minutes';
    $cron$
  );
END
$migration$;
