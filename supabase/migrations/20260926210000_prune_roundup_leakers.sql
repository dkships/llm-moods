-- Prune low-signal accounts from the leaker/press roundup lane.
--
-- 60-day audit (2026-07-29 to 2026-09-26) of this lane's Twitter rows:
--   scaling01   118 posts, 2 with rumor claims; commentary, not leaks, yet
--               all 136 rows fed sentiment scoring
--   nima_owji    21 posts, 0 claims
--   bedros_p     14 posts, 0 claims
--   Fried_rice    1 post, last on 2026-07-23
-- pankajkumar_dev stays in the query (often early) but loses the
-- artifact-leak tier in rumor-canon.ts. Frees ~60 chars (389 total)
-- for future leakers; cost is unchanged (per-query floor).

UPDATE public.scraper_config
SET value = '((from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:m1astra OR from:pankajkumar_dev OR from:lyraxana) OR ((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath OR from:haydenfield) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI))) lang:en -filter:retweets'
WHERE scraper = 'scrape-twitter' AND key = 'search_term'
  AND value = '((from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji OR from:Fried_rice OR from:pankajkumar_dev OR from:lyraxana) OR ((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath OR from:haydenfield) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI))) lang:en -filter:retweets';
