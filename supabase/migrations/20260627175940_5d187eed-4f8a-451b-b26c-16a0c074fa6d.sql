INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term', v.value
FROM (VALUES
  ('((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI)) lang:en -filter:retweets')
) AS v(value)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config sc
  WHERE sc.scraper = 'scrape-twitter' AND sc.key = 'search_term' AND sc.value = v.value
);