DO $migration$
DECLARE
  job_id bigint;
  anon_token text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4';
  base_url text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1';
BEGIN
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