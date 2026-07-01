-- Auto-retire launched models from the rumors radar via a persisted flag.
--
-- 20260701120000 filtered a hardcoded `version_key` list. This replaces that with
-- an `is_released` column that `aggregate-rumors` keeps current automatically:
--   * API layer  — the Anthropic + Gemini Models APIs list shipped ids each run
--     (see _shared/released-models.ts), authoritative for those two families.
--   * Social layer — a GA announcement from a credible source (official vendor
--     domain/handle or a press scoop) flips the flag for ChatGPT/Grok/codenames
--     (see _shared/release-detect.ts).
-- The frontend `FAMILY_ALIASES.released` flag (rumor-canon.ts) stays as the
-- instant, zero-deploy display layer; this column is the durable backend one.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.model_rumors
  ADD COLUMN IF NOT EXISTS is_released boolean NOT NULL DEFAULT false;

-- Seed the versions already known launched (mirrors the list the 20260701120000
-- RPC filtered). aggregate-rumors re-derives + extends this set on every run.
UPDATE public.model_rumors
SET is_released = true, updated_at = now()
WHERE version_key = ANY (ARRAY['fable5','mythos5','mythos','fable','sonnet5','sonic5']::text[])
  AND is_released = false;

-- Swap the static NOT-IN gate for the column. RETURNS signature unchanged (the
-- flag is not exposed), so no types.ts RPC-shape churn. Repo convention is
-- DROP + CREATE for this function.
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
    AND r.is_released IS NOT TRUE   -- launched versions are retired from the radar
  ORDER BY r.has_credible_source DESC,
           COALESCE(array_length(r.platforms, 1), 0) DESC,
           r.mention_count DESC,
           r.last_seen_at DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_rumors() TO anon, authenticated;
