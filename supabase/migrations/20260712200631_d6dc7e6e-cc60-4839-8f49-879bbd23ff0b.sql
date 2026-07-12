SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

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