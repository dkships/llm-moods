-- Give Grok its own Twitter lane at zero extra cost.
--
-- apidojo bills a 50-tweet floor per query and documents five batched
-- queries per run, so the lane count is fixed at five. Grok shared the
-- "merged" sentiment lane with Claude and Gemini, whose keywords out-volume
-- it: over the 14 days to 2026-09-20 Twitter produced 1,447 Claude rows,
-- 297 Gemini rows and 172 Grok rows (36 relevant — 2.5/day). Grok's
-- non-App-Store volume sat around 14 relevant posts/day, which is why its
-- daily row was thin until evening.
--
-- The two `from:` roundup lanes (leakers, press) yielded 366 tweets across
-- 26 runs (~14 per run against a 100-tweet floor), so merging them into one
-- lane loses nothing and frees the fifth slot for Grok. Query length stays
-- under X's ~512-char search limit (merged roundup ≈ 430 chars).
--
-- Result: same 5 queries, same 250 max_items, same $0.15/run cap.

-- 1. Merge the leaker and press roundups into one lane.
UPDATE public.scraper_config
SET value = '((from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji OR from:Fried_rice OR from:pankajkumar_dev) OR ((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath OR from:haydenfield) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI))) lang:en -filter:retweets'
WHERE scraper = 'scrape-twitter' AND key = 'search_term'
  AND value = '(from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji OR from:Fried_rice OR from:pankajkumar_dev) lang:en -filter:retweets';

DELETE FROM public.scraper_config
WHERE scraper = 'scrape-twitter' AND key = 'search_term'
  AND value = '((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath OR from:haydenfield) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI)) lang:en -filter:retweets';

-- 2. Drop Grok from the merged sentiment lane (Claude + Gemini remain).
UPDATE public.scraper_config
SET value = '("claude" OR "claude ai" OR "claude code" OR anthropic OR "gemini" OR "google gemini" OR "gemini ai") lang:en -filter:retweets'
WHERE scraper = 'scrape-twitter' AND key = 'search_term'
  AND value = '("claude" OR "claude ai" OR "claude code" OR anthropic OR "gemini" OR "google gemini" OR "gemini ai" OR "grok 4" OR "grok 4.6" OR "supergrok" OR "grok imagine" OR "grok ai" OR "xai grok") lang:en -filter:retweets';

-- 3. Grok's own lane. Product terms only — bare "grok" and "@grok" match bot
-- summons ("@grok is this true?") and were 100% irrelevant on 2026-09-01.
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term',
       '("grok 4" OR "grok 4.6" OR "grok 4.7" OR "grok 5" OR "supergrok" OR "grok imagine" OR "grok ai" OR "xai grok" OR "grok code" OR "grok heavy") lang:en -filter:retweets'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-twitter' AND key = 'search_term' AND value LIKE '("grok 4" OR "grok 4.6"%'
);
