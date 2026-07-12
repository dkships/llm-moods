-- Expand primary rumor discovery inside the existing five-query Twitter run.
-- Replacing rows (rather than adding queries) keeps Apify's per-query billing
-- floor and the $0.15 run cap unchanged.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- Chaofan Shou (@Fried_rice) finds source/package artifacts; Pankaj Kumar
-- (@pankajkumar_dev) has surfaced model ids in third-party APIs and clearly
-- distinguishes a sighting from an imminent launch. Bedros P and Nima Owji stay
-- discovery-only; source quality is decided by rumor-canon, not query inclusion.
DELETE FROM public.scraper_config
WHERE scraper = 'scrape-twitter'
  AND key = 'search_term'
  AND value IN (
    '(from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji) lang:en -filter:retweets',
    '(from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji OR from:Fried_rice OR from:pankajkumar_dev) lang:en -filter:retweets'
  );

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term',
  '(from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji OR from:Fried_rice OR from:pankajkumar_dev) lang:en -filter:retweets'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.scraper_config
  WHERE scraper = 'scrape-twitter'
    AND key = 'search_term'
    AND value = '(from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji OR from:Fried_rice OR from:pankajkumar_dev) lang:en -filter:retweets'
);

-- Hayden Field covers frontier-model launches and previews. Fold her into the
-- existing press roundup with the same vendor filter and no new query.
DELETE FROM public.scraper_config
WHERE scraper = 'scrape-twitter'
  AND key = 'search_term'
  AND value IN (
    '((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI)) lang:en -filter:retweets',
    '((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath OR from:haydenfield) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI)) lang:en -filter:retweets'
  );

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term',
  '((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath OR from:haydenfield) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI)) lang:en -filter:retweets'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.scraper_config
  WHERE scraper = 'scrape-twitter'
    AND key = 'search_term'
    AND value = '((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath OR from:haydenfield) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI)) lang:en -filter:retweets'
);
