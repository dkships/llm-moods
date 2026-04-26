INSERT INTO public.model_keywords (model_id, keyword, tier, context_words)
SELECT model_id, keyword, tier, context_words
FROM (VALUES
  ('a1b2c3d4-0003-4000-8000-000000000003'::uuid, 'gemini', 'high', NULL::text),
  ('a1b2c3d4-0003-4000-8000-000000000003'::uuid, 'bard', 'high', NULL::text),
  ('a1b2c3d4-0003-4000-8000-000000000003'::uuid, 'gemini 3', 'high', NULL::text),
  ('a1b2c3d4-0003-4000-8000-000000000003'::uuid, 'gemini 3 pro', 'high', NULL::text),
  ('a1b2c3d4-0003-4000-8000-000000000003'::uuid, 'gemini 3 flash', 'high', NULL::text),
  ('a1b2c3d4-0004-4000-8000-000000000004'::uuid, 'grok', 'high', NULL::text),
  ('a1b2c3d4-0004-4000-8000-000000000004'::uuid, 'grok 5', 'high', NULL::text),
  ('a1b2c3d4-0004-4000-8000-000000000004'::uuid, 'xai', 'high', NULL::text)
) AS new_keywords(model_id, keyword, tier, context_words)
WHERE NOT EXISTS (
  SELECT 1 FROM public.model_keywords mk
  WHERE mk.model_id = new_keywords.model_id
    AND mk.keyword = new_keywords.keyword
);

CREATE OR REPLACE FUNCTION public.get_source_breakdown(p_model_id uuid)
RETURNS TABLE (
  source text,
  count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT source, COUNT(*) AS count
  FROM scraped_posts
  WHERE model_id = p_model_id
    AND posted_at > (now() - interval '30 days')
  GROUP BY source
  ORDER BY count DESC, source;
$$;