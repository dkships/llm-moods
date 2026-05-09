-- Decompose the run-pipeline orchestrator into independent crons.
--
-- Background: run-pipeline merges scrape + classify + score into a single
-- edge function. Supabase's documented edge-function wall-clock ceiling is
-- 400 s; sequential awaits of 5 scrapers (Reddit Apify alone polls up to
-- 105 s) + Gemini classification + score refresh cannot fit. The platform
-- kills the function before reaching refreshScores(), so vibes_scores
-- never updates and the dashboard goes stale.
--
-- Fix: each scraper and the score aggregator runs on its own pg_cron row,
-- each invocation living within its own 400 s budget. The pre-existing
-- drain-classification-queue-15min cron is left alone — it points at the
-- (now rewritten) drain function which will start working immediately on
-- the new scraped_posts.classification_status='pending' schema. Matches
-- Supabase guidance for fan-out workloads:
-- https://supabase.com/blog/processing-large-jobs-with-edge-functions
--
-- Cost note: Apify and Gemini call counts are unchanged from the
-- 3x-daily orchestrator pattern (5 scrapers x 3 windows = 15 scraper
-- invocations/day; Gemini drain capped by claim_api_quota at 200 RPD).

DO $migration$
DECLARE
  job_id bigint;
  anon_token text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4';
  base_url text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1';
BEGIN
  -- Unschedule the broken orchestrator + any orphaned legacy crons + our
  -- own new target names (so this migration is idempotent if re-applied).
  -- DO NOT unschedule:
  --   * cleanup-old-posts-weekly      (still useful)
  --   * cleanup-stuck-scraper-runs    (still useful: marks any hung run failed)
  --   * drain-classification-queue-15min (existing, points at drain fn we just
  --     rewrote — will start working at 15 min cadence post-redeploy)
  FOR job_id IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'run-pipeline-3x-daily',
      'run-scrapers-hourly',
      'run-scrapers-hackernews-hourly',
      'run-scrapers-bluesky-hourly',
      'run-scrapers-mastodon-hourly',
      'run-scrapers-twitter-hourly',
      'run-scrapers-reddit-hourly',
      'aggregate-vibes-hourly',
      'reaggregate-vibes-recent',
      'run-scrapers-nightly-reaggregate-0930-utc',
      'run-scrapers-nightly-reaggregate-1030-utc',
      'drain-queue-trigger',
      'invoke-aggregate-vibes-hourly',
      'invoke-reaggregate-vibes-daily',
      'scrape-reddit-apify-3x',
      'scrape-hackernews-3x',
      'scrape-bluesky-3x',
      'scrape-twitter-3x',
      'scrape-mastodon-3x',
      'aggregate-vibes-q30'
    )
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  -- Per-scraper crons: 04:00 / 12:00 / 21:00 UTC = 21:00 PT prev day / 05:00 PT / 14:00 PT.
  -- Staggered by minute to avoid contending on the shared Apify token and Gemini quota
  -- when later steps fire.
  PERFORM cron.schedule(
    'scrape-reddit-apify-3x', '0 4,12,21 * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/scrape-reddit-apify',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"scrape-reddit-apify"}'::jsonb
      );
    $cron$, base_url, anon_token)
  );

  PERFORM cron.schedule(
    'scrape-hackernews-3x', '2 4,12,21 * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/scrape-hackernews',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"scrape-hackernews"}'::jsonb
      );
    $cron$, base_url, anon_token)
  );

  PERFORM cron.schedule(
    'scrape-bluesky-3x', '4 4,12,21 * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/scrape-bluesky',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"scrape-bluesky"}'::jsonb
      );
    $cron$, base_url, anon_token)
  );

  PERFORM cron.schedule(
    'scrape-twitter-3x', '6 4,12,21 * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/scrape-twitter',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"scrape-twitter"}'::jsonb
      );
    $cron$, base_url, anon_token)
  );

  PERFORM cron.schedule(
    'scrape-mastodon-3x', '8 4,12,21 * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/scrape-mastodon',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"scrape-mastodon"}'::jsonb
      );
    $cron$, base_url, anon_token)
  );

  -- Refresh vibes_scores every 30 min on minutes 20 and 50 — offset 5 min
  -- after the existing drain-classification-queue-15min runs (cron `*/15`
  -- fires at :00/:15/:30/:45) so most invocations see freshly classified
  -- posts rather than in-flight ones. aggregate-vibes is intentionally
  -- ungated; its action set is bounded and idempotent.
  PERFORM cron.schedule(
    'aggregate-vibes-q30', '20,50 * * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/aggregate-vibes',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{}'::jsonb
      );
    $cron$, base_url, anon_token)
  );
END
$migration$;
