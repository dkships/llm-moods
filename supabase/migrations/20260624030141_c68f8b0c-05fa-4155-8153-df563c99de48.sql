-- Rumors v1.1 sourcing: capture Twitter author identity, recognize credible
-- sources, and surface credible single-source leaks. Adds author columns +
-- has_credible_source, a from:synthwavedd leaker term, and replaces the two RPCs
-- (get_rumor_candidates returns the author cols; get_public_rumors gates on
-- mention_count >= 2 OR has_credible_source and leads with credibility).

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.scraped_posts
  ADD COLUMN IF NOT EXISTS author_handle text,
  ADD COLUMN IF NOT EXISTS author_verified boolean,
  ADD COLUMN IF NOT EXISTS author_followers integer;

ALTER TABLE public.model_rumors
  ADD COLUMN IF NOT EXISTS has_credible_source boolean NOT NULL DEFAULT false;

-- Reliably pull the tracked leaker's scoops regardless of keyword/recency. One
-- row = one apidojo query. Add the cited set here once approved (mirror the
-- KNOWN_LEAKERS set in _shared/rumor-rollup.ts).
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-twitter', 'search_term', 'from:synthwavedd'
WHERE NOT EXISTS (
  SELECT 1 FROM public.scraper_config
  WHERE scraper = 'scrape-twitter' AND key = 'search_term' AND value = 'from:synthwavedd'
);

-- Return type changes (added columns) require a DROP before CREATE.
DROP FUNCTION IF EXISTS public.get_rumor_candidates(integer);
CREATE FUNCTION public.get_rumor_candidates(p_limit integer DEFAULT 200)
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
  author_followers integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '45s'
AS $$
  SELECT d.id, d.source, d.source_url, d.title, d.content, d.posted_at, d.score,
         d.author_handle, d.author_verified, d.author_followers
  FROM (
    SELECT DISTINCT ON (sp.source_url)
      sp.id, sp.source, sp.source_url, sp.title, sp.content, sp.posted_at, sp.score,
      sp.author_handle, sp.author_verified, sp.author_followers
    FROM (
      SELECT sp2.id, sp2.source, sp2.source_url, sp2.title, sp2.content, sp2.posted_at, sp2.score,
             sp2.author_handle, sp2.author_verified, sp2.author_followers
      FROM public.scraped_posts sp2
      WHERE sp2.rumor_checked_at IS NULL
        AND sp2.posted_at >= now() - interval '10 days'
        AND sp2.source_url IS NOT NULL
        AND (
          COALESCE(sp2.title, '') ~* 'leaked?|spotted|sighting|model[- ]?string|model[- ]?id|api string|sitemap|changelog|stealth|cloaked|codename|arena|incoming|in testing|early access|\yEAP\y|canary|imminent|dropping|drops? (?:next|this)|rolling out|rolls? out|release date|coming (?:soon|next|this)|(?:next|this) (?:week|month)|any day now|scheduled|delayed|pushed back|slipped|postponed|stalled|no longer (?:releas|launch|drop)|give us until|returning|re-?added?|brought back|back out|reinstat|restored?|\ysus\y|rumou?red?'
          OR COALESCE(sp2.content, '') ~* 'leaked?|spotted|sighting|model[- ]?string|model[- ]?id|api string|sitemap|changelog|stealth|cloaked|codename|arena|incoming|in testing|early access|\yEAP\y|canary|imminent|dropping|drops? (?:next|this)|rolling out|rolls? out|release date|coming (?:soon|next|this)|(?:next|this) (?:week|month)|any day now|scheduled|delayed|pushed back|slipped|postponed|stalled|no longer (?:releas|launch|drop)|give us until|returning|re-?added?|brought back|back out|reinstat|restored?|\ysus\y|rumou?red?'
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

DROP FUNCTION IF EXISTS public.get_public_rumors();
CREATE FUNCTION public.get_public_rumors()
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
  has_credible_source boolean,
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
    r.has_credible_source,
    r.representative_sources,
    r.first_seen_at,
    r.last_seen_at
  FROM public.model_rumors r
  WHERE (r.mention_count >= 2 OR r.has_credible_source)
    AND r.last_seen_at >= now() - interval '21 days'
  ORDER BY r.has_credible_source DESC,
           COALESCE(array_length(r.platforms, 1), 0) DESC,
           r.mention_count DESC,
           r.last_seen_at DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_rumors() TO anon, authenticated;