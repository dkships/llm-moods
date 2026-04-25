CREATE OR REPLACE FUNCTION public.get_recent_errors(hours_back integer DEFAULT 24)
RETURNS TABLE (
  function_name text,
  context text,
  error_count bigint,
  last_seen timestamptz,
  sample_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.function_name,
    e.context,
    COUNT(*)::bigint AS error_count,
    MAX(e.created_at) AS last_seen,
    (ARRAY_AGG(e.error_message ORDER BY e.created_at DESC))[1] AS sample_message
  FROM public.error_log e
  WHERE e.created_at > now() - (hours_back || ' hours')::interval
    AND e.error_message IS NOT NULL
    AND e.error_message NOT IN ('Function started')
    AND e.error_message NOT LIKE 'Successfully aggregated vibes%'
  GROUP BY e.function_name, e.context
  ORDER BY error_count DESC, last_seen DESC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_recent_errors(integer) TO anon, authenticated;