-- Source quality pass (OPERATIONS-HISTORY 2026-11-17). Measured on 14 days of
-- classifier-labeled posts: Bluesky was 8.5% relevant, Twitter 17%.
--
-- 1. get_noisy_authors: accounts with 10+ posts in 14 days and none classified
--    relevant. scrape-bluesky skips their non-rumor posts. 30 such Bluesky
--    accounts were 18.7% of volume and 3.4% of relevant posts.
-- 2. Bluesky search terms move from code to scraper_config (SQL edits, no
--    redeploy). Rumor terms are no longer listed here: the scrapers append the
--    live radar's unreleased rumors at run time (_shared/search-terms.ts).
--    Dropped terms matched 0 posts in 14 days (Orionmist, Lithiumflow,
--    Honeycomb) or were released names that mostly caught launch news
--    ("GPT-6": 882 posts, 32 relevant).
-- 3. Twitter: the sentiment lanes lose bare `openai` / `anthropic` (company
--    news; 11% of volume, 1.4% of relevant), and the rumor lane's hand-kept
--    codename list becomes the {ACTIVE_RUMORS} placeholder.
-- Applied to production 2026-11-17 via query_database; this keeps history in sync.

CREATE OR REPLACE FUNCTION public.get_noisy_authors(
  p_source text,
  p_days integer DEFAULT 14,
  p_min_posts integer DEFAULT 10
)
RETURNS TABLE (author_handle text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.author_handle
  FROM public.scraped_posts p
  WHERE p.source = p_source
    AND p.author_handle IS NOT NULL
    AND p.created_at > now() - make_interval(days => p_days)
    AND p.classification_status IN ('classified', 'irrelevant')
  GROUP BY p.author_handle
  HAVING count(*) >= p_min_posts
     AND count(*) FILTER (WHERE p.classification_status = 'classified') = 0
$$;

REVOKE ALL ON FUNCTION public.get_noisy_authors(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_noisy_authors(text, integer, integer) TO service_role;

DELETE FROM public.scraper_config WHERE scraper = 'scrape-bluesky' AND key = 'search_term';
INSERT INTO public.scraper_config (scraper, key, value) VALUES
  ('scrape-bluesky', 'search_term', 'ChatGPT'),
  ('scrape-bluesky', 'search_term', 'Claude AI'),
  ('scrape-bluesky', 'search_term', 'Claude Code'),
  ('scrape-bluesky', 'search_term', 'Gemini AI'),
  ('scrape-bluesky', 'search_term', 'Grok AI'),
  -- Current model names: people name the model they use. Refresh on launch day
  -- (same checklist as src/data/vendor-events.ts). term_hits in run metadata
  -- shows a term going stale.
  ('scrape-bluesky', 'search_term', 'Opus 5.5'),
  ('scrape-bluesky', 'search_term', 'Fable 5.2'),
  ('scrape-bluesky', 'search_term', 'GPT-6.2'),
  ('scrape-bluesky', 'search_term', 'Gemini 4');

UPDATE public.scraper_config
SET value = '("chatgpt" OR "chat gpt" OR "openai gpt") lang:en -filter:retweets'
WHERE scraper = 'scrape-twitter' AND key = 'search_term'
  AND value = '("chatgpt" OR "chat gpt" OR "openai gpt" OR openai) lang:en -filter:retweets';

UPDATE public.scraper_config
SET value = '("claude" OR "claude ai" OR "claude code" OR "gemini" OR "google gemini" OR "gemini ai") lang:en -filter:retweets'
WHERE scraper = 'scrape-twitter' AND key = 'search_term'
  AND value = '("claude" OR "claude ai" OR "claude code" OR anthropic OR "gemini" OR "google gemini" OR "gemini ai") lang:en -filter:retweets';

UPDATE public.scraper_config
SET value = '({ACTIVE_RUMORS} OR ((leaked OR "in testing" OR "release date" OR "spotted in the api") (Claude OR Anthropic OR GPT OR OpenAI OR Gemini OR Grok))) lang:en -filter:retweets'
WHERE scraper = 'scrape-twitter' AND key = 'search_term'
  AND value LIKE '(("Opus 5"%';
