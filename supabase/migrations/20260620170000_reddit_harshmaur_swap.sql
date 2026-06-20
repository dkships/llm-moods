-- Reddit actor swap to the bake-off winner: harshmaur/reddit-scraper.
-- The old trudax-lite actor relied on Reddit's public .json API, which Reddit
-- shut down (403) in May 2026 — hence ~75% degraded runs / ~14 items. harshmaur
-- is HTML-parsing on residential proxies (bake-off: 100% success, fast, rich
-- posts+comments, reaches every target subreddit). The edge function also
-- defaults to this actor in code; these rows pin the choice (revertible via
-- config: set actor_id back to trudax/reddit-scraper-lite) and set comment caps.

-- Pin actor + comment/throughput settings (idempotent per single-value key).
UPDATE public.scraper_config SET value = 'harshmaur/reddit-scraper' WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_id';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'actor_id', 'harshmaur/reddit-scraper'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_id');

UPDATE public.scraper_config SET value = 'true' WHERE scraper = 'scrape-reddit-apify' AND key = 'include_comments';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'include_comments', 'true'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'include_comments');

UPDATE public.scraper_config SET value = '10' WHERE scraper = 'scrape-reddit-apify' AND key = 'max_posts_per_sub';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'max_posts_per_sub', '10'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'max_posts_per_sub');

UPDATE public.scraper_config SET value = '4' WHERE scraper = 'scrape-reddit-apify' AND key = 'max_comments_per_post';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'max_comments_per_post', '4'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'max_comments_per_post');

UPDATE public.scraper_config SET value = '4' WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_concurrency';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'actor_concurrency', '4'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_concurrency');

-- Add r/ChatGPTPro (verified active; paying users = sharp quality complaints).
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'start_url', 'https://www.reddit.com/r/ChatGPTPro/new/'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-reddit-apify' AND key = 'start_url' AND value = 'https://www.reddit.com/r/ChatGPTPro/new/'
);
