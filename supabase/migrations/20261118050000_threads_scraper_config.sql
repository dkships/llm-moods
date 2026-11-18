-- Threads via Apify (scrape-threads), 2026-11-17. Same terms as Bluesky.
-- Production went through the trial as lergassy/threads-scraper at 25 posts
-- per term, then was switched to futurizerush/meta-threads-scraper at 10 (the
-- actor's minimum), because lergassy's "recent" page is not recent. No cron row:
-- the trial was 4 relevant of 45 (OPERATIONS-HISTORY 2026-11-17 evening).
-- Applied to production 2026-11-17 via query_database.

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-threads', v.key, v.value
FROM (VALUES
  ('actor_id', 'futurizerush/meta-threads-scraper'),
  ('max_posts_per_term', '10'),
  ('monitoring_store', 'llm-vibes-threads'),
  ('search_term', 'ChatGPT'),
  ('search_term', 'Claude AI'),
  ('search_term', 'Claude Code'),
  ('search_term', 'Gemini AI'),
  ('search_term', 'Grok')
) AS v(key, value)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config c
  WHERE c.scraper = 'scrape-threads' AND c.key = v.key AND c.value = v.value
);
