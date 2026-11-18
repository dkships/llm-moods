-- Threads via Apify (scrape-threads, lergassy/threads-scraper), 2026-11-17.
-- Same terms as Bluesky: single words search best on Threads, and bare
-- "Gemini" is mostly astrology there. 25 posts per term is one recent page.
-- The cron row is added separately (20261118060000) after the trial run.
-- Applied to production 2026-11-17 via query_database.

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-threads', v.key, v.value
FROM (VALUES
  ('actor_id', 'lergassy/threads-scraper'),
  ('max_posts_per_term', '25'),
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
