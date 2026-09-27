-- Track @lyraxana in the leaker/press roundup lane.
--
-- Lyra called the Opus 5.5 release for "as early as Tuesday, September 22"
-- (relayed by @kimmonismus on 2026-09-20); it shipped that day. On
-- 2026-09-26 they posted a Sonnet 5.5 partner checkpoint with a
-- "≤ 2026-09-28 11:00 PT" release. Adding one from: term keeps the query
-- under X's ~512-char limit (461 chars) and costs nothing: same lane
-- count, same max_items, same per-run cap.

UPDATE public.scraper_config
SET value = '((from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji OR from:Fried_rice OR from:pankajkumar_dev OR from:lyraxana) OR ((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath OR from:haydenfield) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI))) lang:en -filter:retweets'
WHERE scraper = 'scrape-twitter' AND key = 'search_term'
  AND value = '((from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji OR from:Fried_rice OR from:pankajkumar_dev) OR ((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath OR from:haydenfield) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI))) lang:en -filter:retweets';
