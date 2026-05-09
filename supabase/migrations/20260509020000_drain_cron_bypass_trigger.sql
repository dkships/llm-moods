-- Re-point drain-classification-queue-15min at the drain function directly,
-- bypassing the drain-queue-trigger trampoline. The trigger was a workaround
-- for the old drain function being service-role-gated; the rewritten drain
-- function (commit d57de1c) accepts pg_cron via the scheduler-body gate, so
-- the trampoline is no longer needed and its DRAIN_QUEUE_TRIGGER_SECRET env
-- has drifted out of sync with the cron header (returning 403).

DO $migration$
DECLARE
  job_id bigint;
  anon_token text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4';
  base_url text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1';
BEGIN
  FOR job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'drain-classification-queue-15min'
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  PERFORM cron.schedule(
    'drain-classification-queue-15min', '*/15 * * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/drain-classification-queue',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"drain-classifications","limit":50}'::jsonb
      );
    $cron$, base_url, anon_token)
  );
END
$migration$;
