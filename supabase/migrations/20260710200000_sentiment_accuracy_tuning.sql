-- Sentiment-accuracy tuning (2026-07-10 audit follow-up).
-- Companion to the same-day code changes in _shared/classifier.ts,
-- _shared/classification-state.ts, _shared/vibes-scoring.ts,
-- _shared/score-refresh.ts, scrape-hackernews, scrape-mastodon, and the new
-- scrape-appstore function. Four independent pieces:
--   1. model_keywords: shipped sub-model names that currently fail attribution
--      ("Opus 4.7 got nerfed", "4o is back", "GPT-5.4 keeps hallucinating"
--      match no high-tier keyword today).
--   2. scrape-twitter max_items 80 -> 250: apidojo bills a 5-query x 50-tweet
--      minimum (~250 tweets) per run regardless, so the 80-item dataset fetch
--      silently discarded up to ~170 already-billed tweets with query-order
--      bias. Zero marginal Apify cost; the $0.15 maxTotalChargeUsd cap holds.
--   3. Reddit start_url net-zero swap: r/OpenAI -> r/Bard. Gemini/Grok have
--      half the dedicated-subreddit coverage of Claude/ChatGPT and r/Bard
--      (historically the largest Gemini community) was never covered; r/OpenAI
--      overlaps r/ChatGPT heavily and skews corporate-news. Same sub count,
--      $0 delta.
--   4. scrape-appstore: cron rows for the new free Apple customer-review RSS
--      scraper (keyless, symmetric across all four models).

-- ---------------------------------------------------------------------------
-- 1. Attribution keywords for shipped sub-model names. High tier: these are
--    unambiguous model references. Bare 'fable' is deliberately excluded
--    (common English word); 'fable 5' already exists from the rumor seeds.
-- ---------------------------------------------------------------------------
INSERT INTO public.model_keywords (model_id, keyword, tier, context_words)
SELECT m.id, v.keyword, 'high', NULL::text
FROM (VALUES
  ('claude', 'opus 4.7'),
  ('claude', 'haiku 4.5'),
  ('claude', 'sonnet 4.6'),
  ('chatgpt', 'gpt-4o'),
  ('chatgpt', '4o'),
  ('chatgpt', 'o4-mini'),
  ('chatgpt', 'gpt-5.4'),
  ('gemini', 'gemini 3.5 flash'),
  ('grok', 'grok 4')
) AS v(slug, keyword)
JOIN public.models m ON m.slug = v.slug
WHERE NOT EXISTS (
  SELECT 1 FROM public.model_keywords mk
  WHERE mk.model_id = m.id AND mk.keyword = v.keyword
);

-- ---------------------------------------------------------------------------
-- 2. Twitter: fetch every tweet the run already paid for.
-- ---------------------------------------------------------------------------
UPDATE public.scraper_config SET value = '250'
WHERE scraper = 'scrape-twitter' AND key = 'max_items';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'max_items', '250'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-twitter' AND key = 'max_items'
);

-- ---------------------------------------------------------------------------
-- 3. Reddit net-zero swap: r/OpenAI -> r/Bard.
-- ---------------------------------------------------------------------------
DELETE FROM public.scraper_config
WHERE scraper = 'scrape-reddit-apify' AND key = 'start_url'
  AND value = 'https://www.reddit.com/r/OpenAI/new/';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'start_url', 'https://www.reddit.com/r/Bard/new/'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-reddit-apify' AND key = 'start_url'
    AND value = 'https://www.reddit.com/r/Bard/new/'
);

-- ---------------------------------------------------------------------------
-- 4. Cron for scrape-appstore: same three Pacific windows as the other free
--    scrapers, staggered at :10. Anon-key + scheduler body (public-repo-safe
--    gate; the function accepts the pg_cron scheduler body).
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
  job_id bigint;
  anon_token text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4';
  base_url text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1';
BEGIN
  FOR job_id IN SELECT jobid FROM cron.job WHERE jobname = 'scrape-appstore-3x'
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  PERFORM cron.schedule(
    'scrape-appstore-3x',
    '10 4,12,21 * * *',
    format($cron$
      SELECT net.http_post(
        url := '%s/scrape-appstore',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"scheduler":"pg_cron","pipeline":"scrape-appstore"}'::jsonb
      );
    $cron$, base_url, anon_token)
  );
END
$migration$;
