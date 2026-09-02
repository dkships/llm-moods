-- 2026-09-02 rumor codename keywords (applied live via query_database the same
-- day; every statement is idempotent so a re-run is a no-op).
--
-- Why: r/singularity and r/LocalLLaMA are deliberately absent from
-- SUBREDDIT_MODEL_MAP, so leak posts there attribute ONLY through these rows.
-- The catalog carried no entry for any codename or next version currently on
-- /rumors, so those posts were being dropped.
--
-- Tier choice: matchModels ignores context_words on 'high' and requires one of
-- them on 'ambiguous'. Qualified phrases are unambiguous, so they go in 'high'
-- in hyphen form — matchModels rewrites '-' to [-\s.]?, so one row covers
-- "claude marshmallow", "claude-marshmallow" and "claude-marshmallow-eap".
-- Bare codenames that are ordinary English words stay 'ambiguous'.
--
-- Deliberately NOT added: bare "spark". "Gemini Spark" is a shipped agent
-- product (it ships alongside Claude Cowork and ChatGPT Work), and bare "spark"
-- appears in 120 posts / 30 days, mostly unrelated — only the qualified phrase
-- is safe. Bare "astra" IS safe: all 156 occurrences in the same window were
-- OpenAI codename chatter.

INSERT INTO public.model_keywords (model_id, keyword, tier)
SELECT m.id, k.keyword, 'high'
FROM (VALUES
  ('claude',  'opus 5.1'),
  ('claude',  'sonnet 5.1'),
  ('claude',  'claude-marshmallow'),
  ('claude',  'claude-melon'),
  ('chatgpt', 'gpt-astra'),
  ('gemini',  'gemini 4'),
  ('gemini',  'gemini 3.7'),
  ('gemini',  'gemini 3.8'),
  ('gemini',  'gemini-spark'),
  ('gemini',  'skimaki'),
  ('grok',    'grok 4.7')
) AS k(slug, keyword)
JOIN public.models m ON m.slug = k.slug
WHERE NOT EXISTS (
  SELECT 1 FROM public.model_keywords mk
  WHERE mk.model_id = m.id AND mk.keyword = k.keyword
);

INSERT INTO public.model_keywords (model_id, keyword, tier, context_words)
SELECT m.id, k.keyword, 'ambiguous', k.context_words
FROM (VALUES
  ('claude',  'marshmallow', 'claude,anthropic,opus,eap'),
  ('claude',  'melon',       'claude,anthropic,sonnet,eap'),
  ('chatgpt', 'astra',       'openai,chatgpt,gpt,altman')
) AS k(slug, keyword, context_words)
JOIN public.models m ON m.slug = k.slug
WHERE NOT EXISTS (
  SELECT 1 FROM public.model_keywords mk
  WHERE mk.model_id = m.id AND mk.keyword = k.keyword
);
