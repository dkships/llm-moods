-- Halve drain batch_size from 40 to 20 to cap Gemini batch JSON output size.
--
-- The 2026-05-15 diagnostic showed all 71+ failures over 24h were JSON parse
-- errors at byte positions 5199 / 14235 — exactly the truncation boundary
-- for ~4096 output tokens. Even after bumping batchTokens 4096 → 8192 in
-- _shared/classifier.ts and redeploying, failures persisted at the same
-- positions. Two possible explanations:
--   (a) Lovable redeploy didn't refresh the _shared module in the runtime
--   (b) Gemini's OpenAI-compatible endpoint silently caps max_tokens at
--       ~4096 for gemini-2.5-flash in JSON mode (known behavioral quirk
--       around max_completion_tokens semantics)
--
-- Halving batch_size fixes both: 20 results × ~200-350 bytes each ≈ 4-7 KB
-- of JSON, comfortably below either ceiling. limit stays at 200 so total
-- per-pass throughput is unchanged (10 batches of 20 vs 5 batches of 40).

DO $migration$
DECLARE
  job_id bigint;
  anon_token text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4';
  base_url text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1';
BEGIN
  FOR job_id IN
    SELECT jobid FROM cron.job WHERE jobname IN (
      'drain-classification-queue-5min',
      'drain-classification-queue-15min',
      'drain-classification-queue-2min'
    )
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  PERFORM cron.schedule(
    'drain-classification-queue-2min', '*/2 * * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/drain-classification-queue',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"drain-classifications","limit":200,"batch_size":20}'::jsonb
      );
    $cron$, base_url, anon_token)
  );
END
$migration$;
