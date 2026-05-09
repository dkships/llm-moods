-- Reduce drain batch limit from 50 -> 20 to keep each pass to a single
-- Gemini call (batchSize is 20). Gemini's effective free-tier cap for
-- gemini-2.5-flash on this account is tighter than the published 250 RPD;
-- with limit=50 each drain pass made 3 Gemini calls, so a single 429 was
-- amplified into multiple wasted calls. limit=20 means a partial-quota
-- failure costs at most 1 wasted call per drain.

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
        body := '{"scheduler":"pg_cron","pipeline":"drain-classifications","limit":20}'::jsonb
      );
    $cron$, base_url, anon_token)
  );
END
$migration$;