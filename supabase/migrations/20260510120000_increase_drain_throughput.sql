-- Raise drain-classification-queue throughput now that the account is on the
-- paid Gemini tier. The May 9 cap to limit=20 was sized to the free-tier ~200
-- RPD ceiling, where a single 429 amplified across 3 calls per drain pass.
-- With paid quota the binding constraint is GEMINI_DAILY_REQUEST_LIMIT (env),
-- not free-tier RPD, so we can outrun ingest:
--   ingest  ~3,000-4,500 posts/day (200-300 per scraper x 5 x 3 windows)
--   drain   80 posts x 4 runs/hr = 7,680/day capacity
-- batch_size=25 is the original design point; classifier handles it without
-- quality drop (see _shared/classifier.ts:759).

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
        body := '{"scheduler":"pg_cron","pipeline":"drain-classifications","limit":80,"batch_size":25}'::jsonb
      );
    $cron$, base_url, anon_token)
  );
END
$migration$;
