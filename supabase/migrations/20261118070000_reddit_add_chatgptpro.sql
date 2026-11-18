-- Reddit: add r/ChatGPTPro (2026-11-17), the paying power-user sub, as the
-- ChatGPT counterpart of r/ClaudeAI.
--
-- Trial run 2026-11-17: 13 of 22 rows relevant (59%, best of any sub; r/ChatGPT
-- 41% over 14 days). Its 2 positive / 11 negative split (15% positive) has a
-- 95% interval of roughly 2-45% at n=13, which covers r/ChatGPT's 28%, so one
-- sample does not show it is an outlier. Under the fixed-mix score a new sub
-- cannot move ChatGPT's Reddit share, only Reddit's level, and that level is
-- re-baselined over 28 days. Re-check around 2026-11-24 with ~140 posts:
-- drop it if relevance falls below r/ChatGPT's or its positive share is
-- clearly outside r/ChatGPT's.
-- +$0.038/day ($1.14/month). Applied to production 2026-11-17.

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'start_url', 'https://www.reddit.com/r/ChatGPTPro/new/'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-reddit-apify' AND key = 'start_url' AND value = 'https://www.reddit.com/r/ChatGPTPro/new/'
);
