DELETE FROM public.scraper_config
WHERE scraper = 'scrape-reddit-apify' AND key = 'start_url' AND value IN (
  'https://www.reddit.com/r/LocalLLaMA/new/',
  'https://www.reddit.com/r/artificial/new/',
  'https://www.reddit.com/r/GoogleGeminiAI/new/'
);

UPDATE public.scraper_config SET value = '8' WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_concurrency';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'actor_concurrency', '8'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_concurrency');

UPDATE public.scraper_config SET value = '100' WHERE scraper = 'scrape-reddit-apify' AND key = 'poll_timeout_secs';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'poll_timeout_secs', '100'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'poll_timeout_secs');