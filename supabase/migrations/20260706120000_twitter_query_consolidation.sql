-- Twitter search-term consolidation: 8 -> 5 queries per apidojo run.
--
-- Why: apidojo~tweet-scraper bills a 50-tweet minimum PER QUERY ($0.0004/tweet),
-- so 8 queries put the nominal billing floor at $0.16/run — above the $0.15
-- maxTotalChargeUsd cap, meaning every run terminates at the cap. Worse, the
-- actor documents "up to 5 batched queries" per run; behavior with 8 terms is
-- undocumented (queries may silently not execute). Consolidating to exactly 5
-- drops the floor to $0.10/run (~$4.5/mo at 3x/day) and puts every query back
-- inside the documented batch limit.
--
-- Shape: keep ChatGPT isolated (highest-volume model must not starve the other
-- three in a shared query), merge Claude+Gemini+Grok into one query, keep the
-- rumor query, fold from:synthwavedd into the leaker roundup (credibility is
-- keyed on the tweet's author handle via TRACKED_LEAKER_HANDLES in
-- _shared/rumor-canon.ts, not on which query fetched it), keep the press
-- roundup. Cadence stays 3x/day; max_items stays 80 (a bump to ~150 is a
-- data-driven follow-up once chargedEventCounts confirms floor billing).
--
-- REVERT: delete the two inserted rows below and re-insert these originals:
--   ("claude" OR "claude ai" OR "claude code" OR anthropic) lang:en -filter:retweets
--   ("gemini" OR "google gemini" OR "gemini ai") lang:en -filter:retweets
--   ("grok" OR "grok ai" OR "xai grok") lang:en -filter:retweets
--   from:synthwavedd
--   (from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01) lang:en -filter:retweets

-- Drop the three per-model rows being merged, the standalone synthwavedd row,
-- and the leaker roundup that the new row supersedes.
DELETE FROM public.scraper_config
WHERE scraper = 'scrape-twitter' AND key = 'search_term' AND value IN (
  '("claude" OR "claude ai" OR "claude code" OR anthropic) lang:en -filter:retweets',
  '("gemini" OR "google gemini" OR "gemini ai") lang:en -filter:retweets',
  '("grok" OR "grok ai" OR "xai grok") lang:en -filter:retweets',
  'from:synthwavedd',
  '(from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01) lang:en -filter:retweets'
);

-- Merged sentiment query (Claude + Gemini + Grok) and the 5-handle leaker roundup.
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
