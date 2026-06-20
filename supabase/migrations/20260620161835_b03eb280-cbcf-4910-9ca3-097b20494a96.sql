-- Reddit sourcing 80/20 fix (sentiment/scraper deep dive, Phase 2 lean).
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'start_url', t.v
FROM (VALUES
  ('https://www.reddit.com/r/grok/new/'),
  ('https://www.reddit.com/r/GeminiAI/new/'),
  ('https://www.reddit.com/r/GoogleGeminiAI/new/'),
  ('https://www.reddit.com/r/ClaudeCode/new/'),
  ('https://www.reddit.com/r/OpenAI/new/')
) AS t(v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-reddit-apify' AND key = 'start_url' AND value = t.v
);

UPDATE public.scraper_config SET value = '150'
  WHERE scraper = 'scrape-reddit-apify' AND key = 'poll_timeout_secs';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'poll_timeout_secs', '150'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-reddit-apify' AND key = 'poll_timeout_secs'
);

UPDATE public.scraper_config SET value = '180'
  WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_timeout_secs';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'actor_timeout_secs', '180'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_timeout_secs'
);

UPDATE public.scraper_config SET value = '50'
  WHERE scraper = 'scrape-reddit-apify' AND key = 'max_items';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'max_items', '50'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-reddit-apify' AND key = 'max_items'
);