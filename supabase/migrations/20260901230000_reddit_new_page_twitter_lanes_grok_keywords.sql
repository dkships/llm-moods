-- 2026-09-01 sourcing fixes (applied live via query_database the same day;
-- every statement is idempotent so a re-run is a no-op).

-- Reddit: harshmaur's subredditUrls mode ignores sort and returned mostly
-- days-old posts (105-144 of 160 per run). new_page feeds /new/ listing
-- URLs via startUrls: 0 stale, 110 net-new rows for $0.34 on first run.
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'listing_mode', 'new_page'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-reddit-apify' AND key = 'listing_mode'
);

-- Twitter: restore the documented 5-lane design. The ChatGPT lane had grown
-- into a superset of the merged lane (Claude/Gemini/Grok searched twice,
-- ChatGPT no longer isolated). Bare "grok" in the merged lane matched
-- "@grok" bot summons (53 of 53 Grok tweets irrelevant on 2026-09-01);
-- product terms replace it.
UPDATE public.scraper_config
SET value = '("chatgpt" OR "chat gpt" OR "openai gpt" OR openai) lang:en -filter:retweets'
WHERE scraper = 'scrape-twitter' AND key = 'search_term'
  AND value = '("claude" OR "claude ai" OR "claude code" OR anthropic OR "chatgpt" OR "chat gpt" OR "openai gpt" OR openai OR "gemini" OR "google gemini" OR "gemini ai" OR "grok" OR "grok ai" OR "xai grok") lang:en -filter:retweets';

UPDATE public.scraper_config
SET value = '("claude" OR "claude ai" OR "claude code" OR anthropic OR "gemini" OR "google gemini" OR "gemini ai" OR "grok 4" OR "grok 4.6" OR "supergrok" OR "grok imagine" OR "grok ai" OR "xai grok") lang:en -filter:retweets'
WHERE scraper = 'scrape-twitter' AND key = 'search_term'
  AND value = '("claude" OR "claude ai" OR "claude code" OR anthropic OR "gemini" OR "google gemini" OR "gemini ai" OR "grok" OR "grok ai" OR "xai grok") lang:en -filter:retweets';

-- Grok keywords: "@grok" was a context word that confirmed bare "grok", so
-- every bot summon became a Grok row. Product names are unambiguous.
UPDATE public.model_keywords
SET context_words = 'xai,x.ai,elon musk,xai grok'
WHERE keyword = 'grok' AND tier = 'ambiguous'
  AND model_id = (SELECT id FROM public.models WHERE slug = 'grok');

INSERT INTO public.model_keywords (model_id, keyword, tier)
SELECT m.id, k.keyword, 'high'
FROM public.models m
CROSS JOIN (VALUES ('grok 4.6'), ('supergrok'), ('grok imagine'), ('grok heavy')) AS k(keyword)
WHERE m.slug = 'grok'
  AND NOT EXISTS (
    SELECT 1 FROM public.model_keywords mk WHERE mk.model_id = m.id AND mk.keyword = k.keyword
  );
