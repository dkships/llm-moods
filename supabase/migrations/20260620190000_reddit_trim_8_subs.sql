-- Reddit 80/20 + edge-timeout fix. The harshmaur swap with 11 subreddits at
-- concurrency 4 ran ~3 sequential waves and blew the edge function's hard 150s
-- request timeout (run killed mid-flight, no data written). Fix: trim to the 8
-- highest-signal per-model subreddits and run them ALL in parallel (concurrency
-- = 8, the code cap) so the whole run finishes well under 150s. Also lowers cost.
--
-- Kept (high per-model signal): ClaudeAI, ClaudeCode, ChatGPT, OpenAI,
-- ChatGPTPro, GoogleGemini, GeminiAI, grok.
-- Dropped (cross-model / redundant, low per-model signal): LocalLLaMA, artificial
-- (general AI subs — the four models are diluted there), GoogleGeminiAI (third
-- Gemini sub, redundant with GeminiAI + GoogleGemini).

DELETE FROM public.scraper_config
WHERE scraper = 'scrape-reddit-apify' AND key = 'start_url' AND value IN (
  'https://www.reddit.com/r/LocalLLaMA/new/',
  'https://www.reddit.com/r/artificial/new/',
  'https://www.reddit.com/r/GoogleGeminiAI/new/'
);

-- Run all 8 subreddits in parallel (one wave) so the run fits the 150s edge limit.
UPDATE public.scraper_config SET value = '8' WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_concurrency';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'actor_concurrency', '8'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'actor_concurrency');

-- Abort any slow subreddit run at 100s so the function returns before the 150s kill.
UPDATE public.scraper_config SET value = '100' WHERE scraper = 'scrape-reddit-apify' AND key = 'poll_timeout_secs';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'poll_timeout_secs', '100'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'poll_timeout_secs');
