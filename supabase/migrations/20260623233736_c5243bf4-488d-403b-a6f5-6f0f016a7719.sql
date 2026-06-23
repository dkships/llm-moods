-- Rumors radar: an automated board of community chatter about UNRELEASED model
-- versions. Adds two nullable columns on scraped_posts (extraction state), the
-- model_rumors accumulator table, the get_rumor_candidates (service-role) gate +
-- get_public_rumors (anon) read RPC, the aggregate-rumors-2x cron, the current-
-- cycle codename/next-version model_keywords, and the Reddit/Twitter rumor config.

-- The ADD COLUMN below is metadata-only (nullable, no default → no table rewrite),
-- but the brief ACCESS EXCLUSIVE lock can queue behind a long query on the
-- continuously-written scraped_posts. Cap the wait so the migration fails fast and
-- can be retried rather than blocking writers (Supabase migration-safety guidance).
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.scraped_posts
  ADD COLUMN IF NOT EXISTS rumor_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS rumor_data jsonb;

-- Self-pruning partial index: covers only un-checked posts, so it shrinks as the
-- aggregate-rumors cron works through the backlog. Speeds the candidate scan.
CREATE INDEX IF NOT EXISTS idx_scraped_posts_rumor_unchecked
  ON public.scraped_posts (posted_at DESC)
  WHERE rumor_checked_at IS NULL;

-- ---------------------------------------------------------------------------
-- model_rumors — the accumulator. One row per (model_slug, version_key).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.model_rumors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_slug text NOT NULL,
  version_key text NOT NULL,
  version_label text,
  codename text,
  claim_type text NOT NULL DEFAULT 'other',
  claim_summary text NOT NULL DEFAULT '',
  rumored_benefit text,
  benefit_verified boolean NOT NULL DEFAULT false,
  signals text,
  eta_text text,
  eta_date date,
  eta_conflicting boolean NOT NULL DEFAULT false,
  mention_count integer NOT NULL DEFAULT 0,
  platforms text[] NOT NULL DEFAULT '{}',
  representative_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_slug, version_key)
);

CREATE INDEX IF NOT EXISTS idx_model_rumors_active
  ON public.model_rumors (last_seen_at DESC)
  WHERE mention_count >= 2;

-- RLS on, no anon policy → direct anon .from() returns []. Public reads go through
-- get_public_rumors below; the aggregate-rumors function writes via service role.
ALTER TABLE public.model_rumors ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- get_rumor_candidates — distinct-source_url posts matching the leak lexicon,
-- not yet extracted. Service-role only (called by the aggregate-rumors fn).
-- PATTERN is a hand-mirror of RUMOR_LEXICON in _shared/rumor-detect.ts, using
-- Postgres ARE word boundaries (\y) on the short tokens (sus, EAP) — keep in sync.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_rumor_candidates(p_limit integer DEFAULT 200)
RETURNS TABLE (
  id uuid,
  source text,
  source_url text,
  title text,
  content text,
  posted_at timestamptz,
  score integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.source, d.source_url, d.title, d.content, d.posted_at, d.score
  FROM (
    SELECT DISTINCT ON (sp.source_url)
      sp.id, sp.source, sp.source_url, sp.title, sp.content, sp.posted_at, sp.score
    FROM (
      SELECT sp2.id, sp2.source, sp2.source_url, sp2.title, sp2.content, sp2.posted_at, sp2.score
      FROM public.scraped_posts sp2
      WHERE sp2.rumor_checked_at IS NULL
        AND sp2.source_url IS NOT NULL
        AND (
          COALESCE(sp2.title, '') ~* 'leaked?|spotted|sighting|model[- ]?string|model[- ]?id|api string|sitemap|changelog|stealth|cloaked|codename|arena|incoming|in testing|early access|\yEAP\y|canary|imminent|dropping|drops? (?:next|this)|rolling out|rolls? out|release date|coming (?:soon|next|this)|(?:next|this) (?:week|month)|any day now|scheduled|delayed|pushed back|slipped|postponed|stalled|no longer (?:releas|launch|drop)|give us until|returning|re-?added?|brought back|back out|reinstat|restored?|\ysus\y|rumou?red?'
          OR COALESCE(sp2.content, '') ~* 'leaked?|spotted|sighting|model[- ]?string|model[- ]?id|api string|sitemap|changelog|stealth|cloaked|codename|arena|incoming|in testing|early access|\yEAP\y|canary|imminent|dropping|drops? (?:next|this)|rolling out|rolls? out|release date|coming (?:soon|next|this)|(?:next|this) (?:week|month)|any day now|scheduled|delayed|pushed back|slipped|postponed|stalled|no longer (?:releas|launch|drop)|give us until|returning|re-?added?|brought back|back out|reinstat|restored?|\ysus\y|rumou?red?'
        )
      ORDER BY sp2.posted_at DESC
      LIMIT 2000
    ) sp
    ORDER BY sp.source_url, sp.posted_at DESC
  ) d
  ORDER BY d.posted_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.get_rumor_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rumor_candidates(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- get_public_rumors — the page's read surface. Active = corroborated (>=2 posts)
-- and not decayed (seen within 21 days), ranked by cross-platform diversity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_rumors()
RETURNS TABLE (
  model_slug text,
  version_label text,
  codename text,
  claim_type text,
  claim_summary text,
  rumored_benefit text,
  benefit_verified boolean,
  signals text,
  eta_text text,
  eta_date date,
  eta_conflicting boolean,
  mention_count integer,
  platform_count integer,
  representative_sources jsonb,
  first_seen_at timestamptz,
  last_seen_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.model_slug,
    r.version_label,
    r.codename,
    r.claim_type,
    r.claim_summary,
    r.rumored_benefit,
    r.benefit_verified,
    r.signals,
    r.eta_text,
    r.eta_date,
    r.eta_conflicting,
    r.mention_count,
    COALESCE(array_length(r.platforms, 1), 0) AS platform_count,
    r.representative_sources,
    r.first_seen_at,
    r.last_seen_at
  FROM public.model_rumors r
  WHERE r.mention_count >= 2
    AND r.last_seen_at >= now() - interval '21 days'
  ORDER BY COALESCE(array_length(r.platforms, 1), 0) DESC, r.mention_count DESC, r.last_seen_at DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_rumors() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Codename + next-version keywords (current cycle). Cross-vendor leak subs
-- attribute ONLY via these, so this list is load-bearing — refresh each cycle.
-- Looked up by slug (no hardcoded model UUIDs). Prefer specific multi-token keys.
-- ---------------------------------------------------------------------------
INSERT INTO public.model_keywords (model_id, keyword, tier, context_words)
SELECT m.id, v.keyword, 'high', NULL::text
FROM (VALUES
  ('claude', 'sonnet 5'),
  ('claude', 'claude sonnet 5'),
  ('claude', 'opus 5'),
  ('claude', 'fable 5'),
  ('claude', 'mythos'),
  ('claude', 'fennec'),
  ('chatgpt', 'gpt-5.5'),
  ('chatgpt', 'gpt-5.6'),
  ('chatgpt', 'gpt-6'),
  ('chatgpt', 'gpt-bidi'),
  ('gemini', 'gemini 3.5'),
  ('gemini', 'gemini 4'),
  ('gemini', 'orionmist'),
  ('gemini', 'lithiumflow'),
  ('gemini', 'nightwhisper'),
  ('grok', 'grok 4.5')
) AS v(slug, keyword)
JOIN public.models m ON m.slug = v.slug
WHERE NOT EXISTS (
  SELECT 1 FROM public.model_keywords mk
  WHERE mk.model_id = m.id AND mk.keyword = v.keyword
);

-- ---------------------------------------------------------------------------
-- Reddit net-zero subreddit swap: drop two redundant/weak subs, add two
-- cross-vendor leak hubs. Stays at 8 runs (~$0 delta). (Single-run consolidation
-- is a separate, live-validated optional change — not done here.)
-- ---------------------------------------------------------------------------
DELETE FROM public.scraper_config
WHERE scraper = 'scrape-reddit-apify' AND key = 'start_url' AND value IN (
  'https://www.reddit.com/r/GoogleGemini/new/',
  'https://www.reddit.com/r/ChatGPTPro/new/'
);

INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'start_url', v.value
FROM (VALUES
  ('https://www.reddit.com/r/singularity/new/'),
  ('https://www.reddit.com/r/LocalLLaMA/new/')
) AS v(value)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config sc
  WHERE sc.scraper = 'scrape-reddit-apify' AND sc.key = 'start_url' AND sc.value = v.value
);

-- ---------------------------------------------------------------------------
-- Twitter: one combined rumor search term (covers all 4 vendors' next versions +
-- codenames + a leak-lexicon sweep) added to the existing apidojo run, plus a
-- max_items bump 50->80 so the rumor term doesn't starve sentiment recall
-- (~+$0.70/mo, within budget; apidojo is pay-per-event capped by maxTotalChargeUsd).
-- ---------------------------------------------------------------------------
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term', v.value
FROM (VALUES
  ('(("Sonnet 5" OR "Opus 5" OR "Fable 5" OR Fennec OR Mythos OR "GPT-5.5" OR "GPT-5.6" OR "GPT-6" OR "Gemini 3.5" OR "Gemini 4" OR Nightwhisper OR Orionmist OR Lithiumflow OR "Grok 5") OR ((leaked OR "in testing" OR "release date" OR "spotted in the api") (Claude OR Anthropic OR GPT OR OpenAI OR Gemini OR Grok))) lang:en -filter:retweets')
) AS v(value)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config sc
  WHERE sc.scraper = 'scrape-twitter' AND sc.key = 'search_term' AND sc.value = v.value
);

UPDATE public.scraper_config SET value = '80'
WHERE scraper = 'scrape-twitter' AND key = 'max_items';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'max_items', '80'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-twitter' AND key = 'max_items'
);

-- ---------------------------------------------------------------------------
-- Cron: aggregate-rumors twice daily, ~40 min after the 04/16 UTC scrape windows
-- so scrapers have ingested. Anon-key + scheduler body (the public-repo-safe gate).
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
  job_id bigint;
  anon_token text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaG1jdW50dHZwbXlsY3hqa2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDgzNDcsImV4cCI6MjA4ODU4NDM0N30.zzccv_H7YbqDml3YQgd05eiSSQSgg_v8Ov1w17BaPc4';
  base_url text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1';
BEGIN
  FOR job_id IN SELECT jobid FROM cron.job WHERE jobname = 'aggregate-rumors-2x'
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;

  PERFORM cron.schedule(
    'aggregate-rumors-2x',
    '40 4,16 * * *',
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