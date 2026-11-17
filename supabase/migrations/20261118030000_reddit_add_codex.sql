-- Reddit: add r/codex (OpenAI's coding agent), the counterpart of r/ClaudeCode,
-- so ChatGPT gets the same chat + coding-agent pair Claude has.
--
-- One trial run per candidate on 2026-11-17 (20 newest posts each, $0.114 total):
--   r/ChatGPTPro  13 of 22 rows relevant (59%), 11 negative / 2 positive
--   r/codex        9 of 21 relevant (43%), 4 negative / 5 positive
--   r/OpenAI       8 of 24 relevant (33%)
--   r/ChatGPT     41% relevant over the prior 14 days (baseline)
-- r/ChatGPTPro is not added on one strongly negative 18-post sample.
-- +$0.038/day ($1.14/month). Applied to production 2026-11-17.

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'start_url', 'https://www.reddit.com/r/codex/new/'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-reddit-apify' AND key = 'start_url' AND value = 'https://www.reddit.com/r/codex/new/'
);
