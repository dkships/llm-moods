
-- Remove DeepSeek and Perplexity models and all their associated data

-- Delete vibes_scores for these models
DELETE FROM public.vibes_scores
WHERE model_id IN (SELECT id FROM public.models WHERE slug IN ('deepseek', 'perplexity'));

-- Delete scraped_posts for these models
DELETE FROM public.scraped_posts
WHERE model_id IN (SELECT id FROM public.models WHERE slug IN ('deepseek', 'perplexity'));

-- Delete model_keywords for these models
DELETE FROM public.model_keywords
WHERE model_id IN (SELECT id FROM public.models WHERE slug IN ('deepseek', 'perplexity'));

-- Delete the models themselves
DELETE FROM public.models WHERE slug IN ('deepseek', 'perplexity');
