-- Owner-approved X leaker accounts (vetted research pass) added as a single
-- combined from:<handle> Twitter query, so their scoops are reliably captured
-- regardless of keyword/recency. One combined row (not five separate queries)
-- keeps the apidojo run within the same maxItems / maxTotalChargeUsd cap.
-- Mirrors the KNOWN_LEAKERS set in _shared/rumor-rollup.ts (synthwavedd already
-- has its own row from 20260623250000_rumor_sourcing.sql).
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term', v.value
FROM (VALUES
  ('(from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01) lang:en -filter:retweets')
) AS v(value)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config sc
  WHERE sc.scraper = 'scrape-twitter' AND sc.key = 'search_term' AND sc.value = v.value
);