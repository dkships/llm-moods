SET LOCAL lock_timeout = '5s';

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
    -- Launched versions (mirror `released` FAMILY_ALIASES + observed legacy keys).
    AND r.version_key <> ALL (ARRAY['fable5','mythos5','mythos','fable',
                                    'sonnet5','sonic5']::text[])
  ORDER BY r.has_credible_source DESC,
           COALESCE(array_length(r.platforms, 1), 0) DESC,
           r.mention_count DESC,
           r.last_seen_at DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_rumors() TO anon, authenticated;