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
    CASE
      WHEN e.context IS NULL THEN 'unknown'
      WHEN length(e.context) <= 80 AND e.context NOT LIKE '{%' THEN e.context
      ELSE 'redacted'
    END AS context,
    COUNT(*)::bigint AS error_count,
    MAX(e.created_at) AS last_seen,
    NULL::text AS sample_message
  FROM public.error_log e
  WHERE e.created_at > now() - (LEAST(GREATEST(COALESCE(hours_back, 24), 1), 168) || ' hours')::interval
    AND e.error_message IS NOT NULL
    AND e.error_message NOT IN ('Function started')
    AND e.error_message NOT LIKE 'Successfully aggregated vibes%'
  GROUP BY e.function_name,
    CASE
      WHEN e.context IS NULL THEN 'unknown'
      WHEN length(e.context) <= 80 AND e.context NOT LIKE '{%' THEN e.context
      ELSE 'redacted'
    END
  ORDER BY error_count DESC, last_seen DESC
  LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_critical_alerts(hours_back integer DEFAULT 24)
RETURNS TABLE (
  id uuid,
  function_name text,
  error_message text,
  context text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.function_name,
    'Critical alert recorded'::text AS error_message,
    CASE
      WHEN e.context IS NULL THEN 'unknown'
      WHEN length(e.context) <= 80 AND e.context NOT LIKE '{%' THEN e.context
      ELSE 'redacted'
    END AS context,
    e.created_at
  FROM public.error_log e
  WHERE e.severity = 'critical'
    AND e.created_at > now() - (LEAST(GREATEST(COALESCE(hours_back, 24), 1), 168) || ' hours')::interval
  ORDER BY e.created_at DESC
  LIMIT 20;
END;
$$;