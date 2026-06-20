DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'scrape-reddit-apify-3x';
  IF jid IS NOT NULL THEN
    PERFORM cron.alter_job(jid, schedule := '0 4,16 * * *');
  END IF;
END $$;