DELETE FROM public.scraper_config
WHERE scraper = 'scrape-twitter' AND key = 'search_term' AND value IN (
  '("claude" OR "claude ai" OR "claude code" OR anthropic) lang:en -filter:retweets',
  '("gemini" OR "google gemini" OR "gemini ai") lang:en -filter:retweets',
  '("grok" OR "grok ai" OR "xai grok") lang:en -filter:retweets',
  'from:synthwavedd',
  '(from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01) lang:en -filter:retweets'
);

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term', v.value
FROM (VALUES
  ('("claude" OR "claude ai" OR "claude code" OR anthropic OR "gemini" OR "google gemini" OR "gemini ai" OR "grok" OR "grok ai" OR "xai grok") lang:en -filter:retweets'),
  ('(from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01) lang:en -filter:retweets')
) AS v(value)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config sc
  WHERE sc.scraper = 'scrape-twitter' AND sc.key = 'search_term' AND sc.value = v.value
);