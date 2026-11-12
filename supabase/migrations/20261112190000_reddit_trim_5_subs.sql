-- Reddit: 8 subreddits -> 5 (ClaudeAI, ClaudeCode, ChatGPT, GeminiAI, grok).
--
-- Each sub is its own harshmaur/reddit-scraper-pro run: $0.01 start + 20 posts
-- x $0.0014 = ~$0.038/day, ~$1.14/month. Measured 2026-10-30..11-12:
--   r/Bard         46 net-new rows, 9 classified relevant in 14 days (0 items 11-12)
--   r/LocalLLaMA   55 net-new, 12 relevant
--   r/singularity  84 net-new,  6 relevant
-- The two leak hubs were added for the rumors radar (20260623120000), which
-- reads irrelevant posts too. Over the last 30 days the extractor pulled 9 raw
-- claims from them (6 singularity, 3 LocalLLaMA), all below the 0.55
-- confidence gate or for non-tracked families (Qwen, Flint): zero reached
-- model_rumors. Applied to production 2026-11-12; this keeps history in sync.

DELETE FROM public.scraper_config
WHERE scraper = 'scrape-reddit-apify'
  AND key = 'start_url'
  AND value IN (
    'https://www.reddit.com/r/Bard/new/',
    'https://www.reddit.com/r/LocalLLaMA/new/',
    'https://www.reddit.com/r/singularity/new/'
  );
