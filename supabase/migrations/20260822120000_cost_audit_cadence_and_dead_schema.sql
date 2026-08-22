-- 2026-08-22 cost/simplicity audit, step 1 (see OPERATIONS-HISTORY.md).
--
-- Apify: the $29/mo plan was exhausted ~day 17 of the cycle (Reddit skipped 28
-- runs in a row, Twitter 42, Aug 6-19) so two of five platforms went dark for
-- two weeks. Cut paid cadence so the plan lasts the month:
--   * Reddit   2x/day x 10 posts/sub  ->  1x/day x 20 posts/sub (same item
--     volume, one actor-start set instead of two; documented lever from the
--     2026-07-17 audit)
--   * Twitter  3x/day -> 2x/day
-- Mastodon: 83% of its classified posts are irrelevant (456 scored out of
-- 2,831 in 30d) for ~10% of classifier spend -> unscheduled. Function + config
-- stay so it can be re-scheduled; historical posts keep source='mastodon'.
--
-- Dead schema (zero references in src/ or supabase/functions/):
--   * classification_queue  - 1,771 rows stuck 'queued' since 2026-05-07
--   * api_quota_usage + claim_api_quota() - only writer; superseded when the
--     classifier left the Gemini-quota-gated path
--   * scraper_config rows with scraper='reddit' - legacy scope never read by
--     loadScraperConfig (live code filters on 'scrape-reddit-apify')
-- Schedules change via cron.alter_job / cron.unschedule so the cron command
-- (and its scheduler token) is untouched.

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'scrape-reddit-apify-3x';
  IF jid IS NOT NULL THEN
    PERFORM cron.alter_job(jid, schedule := '0 4 * * *');
  END IF;

  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'scrape-twitter-3x';
  IF jid IS NOT NULL THEN
    PERFORM cron.alter_job(jid, schedule := '6 4,16 * * *');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scrape-mastodon-3x') THEN
    PERFORM cron.unschedule('scrape-mastodon-3x');
  END IF;
END $$;

UPDATE public.scraper_config
SET value = '20'
WHERE scraper = 'scrape-reddit-apify' AND key = 'max_posts_per_sub';

DELETE FROM public.scraper_config WHERE scraper = 'reddit';

DROP FUNCTION IF EXISTS public.claim_api_quota(text, text, integer, integer);
DROP TABLE IF EXISTS public.api_quota_usage;
DROP TABLE IF EXISTS public.classification_queue;
