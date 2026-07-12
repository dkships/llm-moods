-- Rumor discovery fast lane:
--   * track three additional reverse-engineering/leak accounts and one reporter
--     inside the existing five-query Twitter budget;
--   * add current-cycle attribution keywords;
--   * recognize private-test and app-artifact language in the SQL candidate gate;
--   * aggregate hourly so newly scraped signals reach the board quickly.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- Keep M1Astra as a vetted single-source signal. Bedros P and Nima Owji are
-- discovery-only for now: the scraper fetches them, but rumor-canon requires
-- independent corroboration before their posts can create a public card.
DELETE FROM public.scraper_config
WHERE scraper = 'scrape-twitter'
  AND key = 'search_term'
  AND value IN (
    '(from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01) lang:en -filter:retweets',
    '(from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji) lang:en -filter:retweets'
  );

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term',
  '(from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji) lang:en -filter:retweets'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.scraper_config
  WHERE scraper = 'scrape-twitter'
    AND key = 'search_term'
    AND value = '(from:synthwavedd OR from:btibor91 OR from:apples_jimmy OR from:testingcatalog OR from:scaling01 OR from:m1astra OR from:bedros_p OR from:nima_owji) lang:en -filter:retweets'
);

-- Alex Heath is a curated press source. Fold him into the existing press query
-- rather than adding a sixth query and another per-query Apify billing floor.
DELETE FROM public.scraper_config
WHERE scraper = 'scrape-twitter'
  AND key = 'search_term'
  AND value IN (
    '((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI)) lang:en -filter:retweets',
    '((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI)) lang:en -filter:retweets'
  );

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term',
  '((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI)) lang:en -filter:retweets'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.scraper_config
  WHERE scraper = 'scrape-twitter'
    AND key = 'search_term'
    AND value = '((from:axios OR from:semafor OR from:theinformation OR from:FortuneMagazine OR from:alexeheath) (Anthropic OR Claude OR Fable OR Mythos OR OpenAI OR ChatGPT OR GPT OR Gemini OR DeepMind OR Grok OR xAI)) lang:en -filter:retweets'
);

-- These are already present in the current-cycle search query. Make sure a post
-- containing only the new name/codename can still be attributed to its family.
INSERT INTO public.model_keywords (model_id, keyword, tier, context_words)
SELECT m.id, v.keyword, 'high', NULL::text
FROM (VALUES
  ('claude', 'fable 5.1'),
  ('claude', 'honeycomb'),
  ('grok', 'grok 5')
) AS v(slug, keyword)
JOIN public.models m ON m.slug = v.slug
WHERE NOT EXISTS (
  SELECT 1
  FROM public.model_keywords mk
  WHERE mk.model_id = m.id AND mk.keyword = v.keyword
);

-- Hand-mirror RUMOR_LEXICON plus the conservative GA expressions in
-- release-detect.ts. concat_ws keeps one auditable regex instead of duplicating
-- it for title and content.
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
        AND concat_ws(' ', sp2.title, sp2.content) ~* 'leaked?|spotted|sighting|model[- ]?string|model[- ]?id|api string|sitemap|changelog|stealth|cloaked|codename|arena|checkpoint|feature[- ]?flag|model selector|config(?:uration)?[- ]?string|incoming|in testing|internal(?:ly)? test(?:ed|ing)|early access|private (?:beta|preview)|limited (?:access|preview)|\yEAP\y|\yETA\y|canary|red[- ]?team(?:ed|ing)?|imminent|dropping|drops? (?:next|this)|rolling out|rolls? out|release date|prepar(?:ing|ations?) (?:to|for) launch|wider launch|testing ahead of (?:the )?(?:wider|public|general) launch|enterprise partners? for testing|launch(?:ed)? for .{0,80}testing|coming (?:soon|next|this)|(?:next|this) (?:week|month)|any day now|scheduled|delayed|pushed back|slipped|postponed|stalled|no longer (?:releas|launch|drop)|give us until|returning|re-?added?|brought back|back out|reinstat|restored?|\ysus\y|rumou?red?|now (?:available|live|out|powering)|is (?:now )?(?:available|live)|is now (?:the )?(?:default|preferred) model|general availability|generally available|released today|launched today|out now|shipped today|available (?:starting today|to everyone|to all|for everyone|now in the api|in the api now)|rolling out to (?:everyone|all users|all)|(?:today,? )?we(?:''re|’re| are) launching|you can (?:now )?(?:use|try|access) it (?:now|today)'
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

-- Runs are cheap no-ops when there are no candidates. Keeping :40 preserves the
-- existing post-scrape offset while reducing the maximum aggregation delay.
DO $migration$
DECLARE
  job_id bigint;
  anon_token text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlIiwicmVmIjoidHJobWN1bnR0dnBteWxjeGprYmQiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc3MzAwODM0NywiZXhwIjoyMDg4NTg0MzQ3fQ.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4';
  base_url text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1';
BEGIN
  FOR job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN ('aggregate-rumors-2x', 'aggregate-rumors-hourly')
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  PERFORM cron.schedule(
    'aggregate-rumors-hourly',
    '40 * * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/aggregate-rumors',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"aggregate-rumors"}'::jsonb
      );
    $cron$, base_url, anon_token)
  );
END
$migration$;