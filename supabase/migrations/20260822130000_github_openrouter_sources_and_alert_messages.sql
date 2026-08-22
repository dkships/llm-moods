-- 2026-08-22 cost audit, step 4: two free sources + readable alerts.
--
-- scrape-github-issues: issues on anthropics/claude-code, openai/codex and
-- google-gemini/gemini-cli (free REST, direct attribution) — replaces the
-- Mastodon slot with higher-signal text. scrape-openrouter: diffs OpenRouter's
-- public model list for newly-listed tracked-vendor slugs and feeds them to the
-- rumors radar. Both run on the free 3x/day windows, staggered after appstore.
--
-- Cron rows are created the way 20260805130000_scheduler_token_auth.sql patches
-- them: the body token is read from scheduler_tokens at apply time and the anon
-- bearer is copied from an existing job, so no secret appears in this public
-- migration. Applied live 2026-08-22 via the Lovable MCP.
DO $$
DECLARE
  tok  text;
  anon text;
  base text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/';
  job  record;
BEGIN
  SELECT token INTO tok FROM public.scheduler_tokens WHERE id = 1;
  IF tok IS NULL THEN
    RAISE EXCEPTION 'scheduler_tokens row id=1 missing';
  END IF;
  SELECT substring(command FROM 'Bearer ([A-Za-z0-9_.-]+)') INTO anon
  FROM cron.job WHERE jobname = 'scrape-appstore-3x';
  IF anon IS NULL THEN
    RAISE EXCEPTION 'scrape-appstore-3x cron row missing; cannot derive anon bearer';
  END IF;

  FOR job IN SELECT * FROM (VALUES
      ('scrape-github-issues-3x', '12 4,12,21 * * *', 'scrape-github-issues'),
      ('scrape-openrouter-3x',    '14 4,12,21 * * *', 'scrape-openrouter')
    ) AS t(name, sched, fn)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = job.name) THEN
      PERFORM cron.schedule(
        job.name,
        job.sched,
        format(
          $cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization',%L),
        body := %L::jsonb
      );
    $cmd$,
          base || job.fn,
          'Bearer ' || anon,
          '{"scheduler":"pg_cron","token":"' || tok || '","pipeline":"' || job.fn || '"}'
        )
      );
    END IF;
  END LOOP;
END $$;

-- get_critical_alerts is the only anon-readable window into error_log and is
-- what .github/workflows/pipeline-alerts.yml polls. Watchdog rows carry a
-- descriptive, secret-free message ("[warn] Scraper 'scrape-twitter' has not
-- run in 14h") that the placeholder text hid; surface it for that function
-- only, keep every other function's message redacted.
CREATE OR REPLACE FUNCTION public.get_critical_alerts(hours_back integer DEFAULT 24)
RETURNS TABLE(id uuid, function_name text, error_message text, context text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.function_name,
    CASE
      WHEN e.function_name = 'pipeline-watchdog' THEN left(e.error_message, 160)
      ELSE 'Critical alert recorded'::text
    END AS error_message,
    CASE
      WHEN e.context IS NULL THEN 'unknown'
      WHEN length(e.context) <= 80 AND e.context NOT LIKE '{%' THEN e.context
      ELSE 'redacted'
    END AS context,
    e.created_at
  FROM public.error_log e
  WHERE e.severity = 'critical'
    AND e.created_at > now() - (LEAST(GREATEST(COALESCE(hours_back, 24), 1), 168) || ' hours')::interval
  ORDER BY e.created_at DESC
  LIMIT 20;
END;
$function$;
