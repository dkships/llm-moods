-- 2026-08-22 cost audit, step 2: a token ledger for the production classifier.
-- The drain already parsed OpenAI/Anthropic usage (incl. cached prompt tokens)
-- but discarded it, so the only cost figure on record came from the manual
-- canary harness and drifted badly ($8/mo on record vs ~$28/mo actual).
-- One row per day x model x service_tier; the drain increments it via the RPC
-- after every pass. Cost per row at list price is a one-line SELECT, e.g.
--   prompt_tokens*2 + cached_tokens*0.2 + completion_tokens*12 (/1e6, terra
--   standard; halve for service_tier='flex').
CREATE TABLE IF NOT EXISTS public.classifier_usage_daily (
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  model text NOT NULL,
  service_tier text NOT NULL DEFAULT 'default',
  calls integer NOT NULL DEFAULT 0,
  prompt_tokens bigint NOT NULL DEFAULT 0,
  cached_tokens bigint NOT NULL DEFAULT 0,
  completion_tokens bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, model, service_tier)
);

ALTER TABLE public.classifier_usage_daily ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated are denied outright; service_role bypasses.
REVOKE ALL ON public.classifier_usage_daily FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.classifier_usage_daily TO service_role;

CREATE OR REPLACE FUNCTION public.record_classifier_usage(
  p_model text,
  p_service_tier text,
  p_calls integer,
  p_prompt_tokens bigint,
  p_cached_tokens bigint,
  p_completion_tokens bigint
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.classifier_usage_daily
    (day, model, service_tier, calls, prompt_tokens, cached_tokens, completion_tokens)
  VALUES
    ((now() AT TIME ZONE 'utc')::date, p_model, coalesce(p_service_tier, 'default'),
     p_calls, p_prompt_tokens, p_cached_tokens, p_completion_tokens)
  ON CONFLICT (day, model, service_tier) DO UPDATE SET
    calls = classifier_usage_daily.calls + EXCLUDED.calls,
    prompt_tokens = classifier_usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
    cached_tokens = classifier_usage_daily.cached_tokens + EXCLUDED.cached_tokens,
    completion_tokens = classifier_usage_daily.completion_tokens + EXCLUDED.completion_tokens,
    updated_at = now();
$$;

REVOKE ALL ON FUNCTION public.record_classifier_usage(text, text, integer, bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_classifier_usage(text, text, integer, bigint, bigint, bigint) TO service_role;
