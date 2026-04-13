DO $migration$
DECLARE
  aggregate_job_id bigint;
  reaggregate_job_id bigint;
BEGIN
  SELECT jobid
  INTO aggregate_job_id
  FROM cron.job
  WHERE jobname = 'aggregate-vibes-hourly';

  IF aggregate_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(aggregate_job_id);
  END IF;

  SELECT jobid
  INTO reaggregate_job_id
  FROM cron.job
  WHERE jobname = 'reaggregate-vibes-daily';

  IF reaggregate_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(reaggregate_job_id);
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

  PERFORM cron.schedule(
    'reaggregate-vibes-daily',
    '25 0 * * *',
    $cron$
      SELECT
        net.http_post(
          url := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/reaggregate-vibes',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4'
          ),
          body := '{"days_back":30,"min_posts":5,"dry_run":false}'::jsonb
        );
    $cron$
  );
END
$migration$;
