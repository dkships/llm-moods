-- Hourly pipeline watchdog cron. Calls the new pipeline-watchdog edge
-- function with the standard scheduler-request body so the function's
-- isSchedulerRequest gate accepts the anon-token call from pg_cron.

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

  PERFORM cron.schedule(
    'pipeline-watchdog-1h', '17 * * * *',
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