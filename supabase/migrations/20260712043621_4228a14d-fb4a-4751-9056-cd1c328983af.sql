-- Retire the July launches immediately and make GA announcements eligible for
-- the automatic release pass. Existing rumor rows stay for audit; the public RPC
-- already excludes rows where is_released is true.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

UPDATE public.model_rumors
SET is_released = true,
    updated_at = now()
WHERE is_released = false
  AND (
    version_key = ANY (ARRAY[
      'gpt56', 'gpt56sol', 'gpt56terra', 'gpt56luna',
      'bidi', 'gptbidi', 'gptbidi1', 'gptlive', 'gptlive1',
      'grok45'
    ]::text[])
    OR regexp_replace(lower(COALESCE(version_label, '')), '[^a-z0-9]+', '', 'g') = ANY (ARRAY[
      'gpt56', 'gpt56sol', 'gpt56terra', 'gpt56luna',
      'gptbidi', 'gptbidi1', 'gptlive', 'gptlive1', 'grok45'
    ]::text[])
    OR regexp_replace(lower(COALESCE(codename, '')), '[^a-z0-9]+', '', 'g') = ANY (ARRAY[
      'bidi', 'gptbidi', 'gptbidi1', 'gptlive', 'gptlive1', 'grok45'
    ]::text[])
  );

-- Keep the shipped GPT-Live name attributable to ChatGPT. The older gpt-bidi
-- keyword remains useful for historical/social references to the codename.
INSERT INTO public.model_keywords (model_id, keyword, tier, context_words)
SELECT m.id, v.keyword, 'high', NULL::text
FROM (VALUES
  ('chatgpt', 'gpt-live'),
  ('chatgpt', 'gpt live 1')
) AS v(slug, keyword)
JOIN public.models m ON m.slug = v.slug
WHERE NOT EXISTS (
  SELECT 1
  FROM public.model_keywords mk
  WHERE mk.model_id = m.id AND mk.keyword = v.keyword
);

-- Replace shipped names in the one rumor query with the current unreleased
-- cycle. This stays one Apify query, so the per-query billing floor is unchanged.
DELETE FROM public.scraper_config
WHERE scraper = 'scrape-twitter'
  AND key = 'search_term'
  AND value = '(("Sonnet 5" OR "Opus 5" OR "Fable 5" OR Fennec OR Mythos OR "GPT-5.5" OR "GPT-5.6" OR "GPT-6" OR "Gemini 3.5" OR "Gemini 4" OR Nightwhisper OR Orionmist OR Lithiumflow OR "Grok 5") OR ((leaked OR "in testing" OR "release date" OR "spotted in the api") (Claude OR Anthropic OR GPT OR OpenAI OR Gemini OR Grok))) lang:en -filter:retweets';

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term',
  '(("Opus 5" OR "Fable 5.1" OR Honeycomb OR Fennec OR "GPT-6" OR "Gemini 3.5 Pro" OR "Gemini 4" OR Nightwhisper OR Orionmist OR Lithiumflow OR "Grok 5") OR ((leaked OR "in testing" OR "release date" OR "spotted in the api") (Claude OR Anthropic OR GPT OR OpenAI OR Gemini OR Grok))) lang:en -filter:retweets'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.scraper_config
  WHERE scraper = 'scrape-twitter'
    AND key = 'search_term'
    AND value = '(("Opus 5" OR "Fable 5.1" OR Honeycomb OR Fennec OR "GPT-6" OR "Gemini 3.5 Pro" OR "Gemini 4" OR Nightwhisper OR Orionmist OR Lithiumflow OR "Grok 5") OR ((leaked OR "in testing" OR "release date" OR "spotted in the api") (Claude OR Anthropic OR GPT OR OpenAI OR Gemini OR Grok))) lang:en -filter:retweets'
);

-- The candidate gate now includes conservative GA language as well as rumor
-- language. This lets official/credible launch posts reach release-detect.ts.
CREATE OR REPLACE FUNCTION public.get_rumor_candidates(p_limit integer DEFAULT 200)
RETURNS TABLE (
  id uuid,
  source text,
  source_url text,
  title text,
  content text,
  posted_at timestamptz,
  score integer,
  author_handle text,
  author_verified boolean,
  author_followers integer,
  quoted_status_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '45s'
AS $$
  SELECT d.id, d.source, d.source_url, d.title, d.content, d.posted_at, d.score,
         d.author_handle, d.author_verified, d.author_followers, d.quoted_status_id
  FROM (
    SELECT DISTINCT ON (sp.source_url)
      sp.id, sp.source, sp.source_url, sp.title, sp.content, sp.posted_at, sp.score,
      sp.author_handle, sp.author_verified, sp.author_followers, sp.quoted_status_id
    FROM (
      SELECT sp2.id, sp2.source, sp2.source_url, sp2.title, sp2.content, sp2.posted_at, sp2.score,
             sp2.author_handle, sp2.author_verified, sp2.author_followers, sp2.quoted_status_id
      FROM public.scraped_posts sp2
      WHERE sp2.rumor_checked_at IS NULL
        AND sp2.posted_at >= now() - interval '10 days'
        AND sp2.source_url IS NOT NULL
        AND (
          COALESCE(sp2.title, '') ~* 'leaked?|spotted|sighting|model[- ]?string|model[- ]?id|api string|sitemap|changelog|stealth|cloaked|codename|arena|incoming|in testing|early access|\yEAP\y|\yETA\y|canary|imminent|dropping|drops? (?:next|this)|rolling out|rolls? out|release date|wider launch|testing ahead of (?:the )?(?:wider|public|general) launch|enterprise partners? for testing|launch(?:ed)? for .{0,80}testing|coming (?:soon|next|this)|(?:next|this) (?:week|month)|any day now|scheduled|delayed|pushed back|slipped|postponed|stalled|no longer (?:releas|launch|drop)|give us until|returning|re-?added?|brought back|back out|reinstat|restored?|\ysus\y|rumou?red?|now (?:available|live|out|powering)|is (?:now )?(?:available|live)|is now (?:the )?(?:default|preferred) model|general availability|generally available|released today|launched today|out now|shipped today|available (?:starting today|to everyone|to all|for everyone|now in the api|in the api now)|rolling out to (?:everyone|all users|all)|(?:today,? )?we(?:''re|’re| are) launching|you can (?:now )?(?:use|try|access) it (?:now|today)'
          OR COALESCE(sp2.content, '') ~* 'leaked?|spotted|sighting|model[- ]?string|model[- ]?id|api string|sitemap|changelog|stealth|cloaked|codename|arena|incoming|in testing|early access|\yEAP\y|\yETA\y|canary|imminent|dropping|drops? (?:next|this)|rolling out|rolls? out|release date|wider launch|testing ahead of (?:the )?(?:wider|public|general) launch|enterprise partners? for testing|launch(?:ed)? for .{0,80}testing|coming (?:soon|next|this)|(?:next|this) (?:week|month)|any day now|scheduled|delayed|pushed back|slipped|postponed|stalled|no longer (?:releas|launch|drop)|give us until|returning|re-?added?|brought back|back out|reinstat|restored?|\ysus\y|rumou?red?|now (?:available|live|out|powering)|is (?:now )?(?:available|live)|is now (?:the )?(?:default|preferred) model|general availability|generally available|released today|launched today|out now|shipped today|available (?:starting today|to everyone|to all|for everyone|now in the api|in the api now)|rolling out to (?:everyone|all users|all)|(?:today,? )?we(?:''re|’re| are) launching|you can (?:now )?(?:use|try|access) it (?:now|today)'
        )
      ORDER BY sp2.posted_at DESC
      LIMIT 1000
    ) sp
    ORDER BY sp.source_url, sp.posted_at DESC
  ) d
  ORDER BY d.posted_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.get_rumor_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rumor_candidates(integer) TO service_role;