-- Reddit cost optimization: 3x/day -> 2x/day. Measured posts-only cost is
-- ~$0.286/run; at 3x/day that's ~$26/mo, which alone nearly exhausts the $29
-- Apify plan once Twitter is added. A daily sentiment metric is well-served by
-- two spaced windows, and reliability holds (two runs/day, so one failed run
-- still leaves same-day coverage). ~$17/mo at 2x/day. Other scrapers unchanged.
-- Only the schedule changes (command/auth untouched) via cron.alter_job. The
-- job keeps its 'scrape-reddit-apify-3x' name (now a 2x cadence — harmless).
DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'scrape-reddit-apify-3x';
  IF jid IS NOT NULL THEN
    PERFORM cron.alter_job(jid, schedule := '0 4,16 * * *');
  END IF;
END $$;
