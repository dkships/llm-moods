-- Fix: get_rumor_candidates timed out on its first run. Because rumor_checked_at
-- starts NULL for EVERY existing post, the `~*` regex scanned the whole table.
-- Bound the scan to recent posts (rumor chatter is about CURRENT activity; older
-- never-checked posts simply age out), add a statement_timeout safety margin, and
-- trim the inner cap. The partial index on (posted_at DESC) WHERE rumor_checked_at
-- IS NULL now serves both the recency range and the ordering.
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
SET statement_timeout = '45s'
AS $$
  SELECT d.id, d.source, d.source_url, d.title, d.content, d.posted_at, d.score
  FROM (
    SELECT DISTINCT ON (sp.source_url)
      sp.id, sp.source, sp.source_url, sp.title, sp.content, sp.posted_at, sp.score
    FROM (
      SELECT sp2.id, sp2.source, sp2.source_url, sp2.title, sp2.content, sp2.posted_at, sp2.score
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
