-- Cheaper Apify actors, same output (side-by-side on live inputs 2026-10-23).
--
-- Reddit: harshmaur/reddit-scraper -> harshmaur/reddit-scraper-pro. Same
-- author, input schema and output keys; $0.01 start + $0.0014/post instead of
-- $0.02 + $0.0018. All 8 /new/ subs x 20 posts: 160/160 items, $0.304 vs
-- $0.448 for the same day's production window (-32%, ~$4.3/mo). No code change.
--
-- Twitter: apidojo/tweet-scraper -> xquik/x-tweet-scraper ($0.00015/tweet, no
-- run fee, vs $0.0004). Needs scrape-twitter CODE_VERSION 2026-10-23.1 or later
-- (queryType + maxItemsPerTarget input, author.username). 250 tweets = 50 per
-- lane, $0.039 vs ~$0.09/run (~$3.6/mo).
--
-- Revert either via config, no redeploy: set actor_id back to the old actor.

UPDATE public.scraper_config SET value = 'harshmaur/reddit-scraper-pro' WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_id';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'actor_id', 'harshmaur/reddit-scraper-pro'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_id');

UPDATE public.scraper_config SET value = 'xquik/x-tweet-scraper' WHERE scraper = 'scrape-twitter' AND key = 'actor_id';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'actor_id', 'xquik/x-tweet-scraper'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-twitter' AND key = 'actor_id');
