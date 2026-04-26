-- Phase 10B: keyword audit for Gemini/Grok + restore 30-day filter on get_source_breakdown
--
-- Two cohesion issues addressed:
--   1. model_keywords had only multi-word HIGH-tier entries for Gemini and Grok
--      ("gemini ai", "grok 4", etc.). Bare "Gemini sucks" or "Grok dropped"
--      tweets fell through to the AMBIGUOUS tier, which requires context_words
--      ("ai,google,model,llm,chatbot" for Gemini), and so were silently filtered
--      out before classification. Adding HIGH-tier entries with no context_words.
--   2. get_source_breakdown was supposed to return last-30-day data per the
--      Apr 11 launch_readiness_guardrails migration, but the live function had
--      reverted to all-time. Re-applies the 30-day filter so the panel matches
--      the Complaint Breakdown's window.

-- 1. Keyword additions
-- model_keywords has no UNIQUE(model_id, keyword) constraint, so we use
-- WHERE NOT EXISTS for idempotency rather than ON CONFLICT.

INSERT INTO public.model_keywords (model_id, keyword, tier, context_words)
SELECT model_id, keyword, tier, context_words
FROM (VALUES
  -- Gemini: bare "gemini" as HIGH so "Gemini disappointed me" matches.
  -- Bard is the legacy product name, still used in some communities.
  ('a1b2c3d4-0003-4000-8000-000000000003'::uuid, 'gemini', 'high', NULL::text),
  ('a1b2c3d4-0003-4000-8000-000000000003'::uuid, 'bard', 'high', NULL::text),
  ('a1b2c3d4-0003-4000-8000-000000000003'::uuid, 'gemini 3', 'high', NULL::text),
  ('a1b2c3d4-0003-4000-8000-000000000003'::uuid, 'gemini 3 pro', 'high', NULL::text),
  ('a1b2c3d4-0003-4000-8000-000000000003'::uuid, 'gemini 3 flash', 'high', NULL::text),
  -- Grok: bare "grok" as HIGH. Risk of false positives on the verb is low —
  -- the classifier's relevance check is the second gate.
  ('a1b2c3d4-0004-4000-8000-000000000004'::uuid, 'grok', 'high', NULL::text),
  ('a1b2c3d4-0004-4000-8000-000000000004'::uuid, 'grok 5', 'high', NULL::text),
  ('a1b2c3d4-0004-4000-8000-000000000004'::uuid, 'xai', 'high', NULL::text)
) AS new_keywords(model_id, keyword, tier, context_words)
WHERE NOT EXISTS (
  SELECT 1 FROM public.model_keywords mk
  WHERE mk.model_id = new_keywords.model_id
    AND mk.keyword = new_keywords.keyword
);

-- 2. Restore 30-day filter on get_source_breakdown
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
