-- Remove DeepSeek and Perplexity models and all their associated data
-- These models are being dropped to focus on the 4 core tracked models

DELETE FROM vibes_scores WHERE model_id IN (SELECT id FROM models WHERE slug IN ('deepseek', 'perplexity'));
DELETE FROM scraped_posts WHERE model_id IN (SELECT id FROM models WHERE slug IN ('deepseek', 'perplexity'));
DELETE FROM model_keywords WHERE model_id IN (SELECT id FROM models WHERE slug IN ('deepseek', 'perplexity'));
DELETE FROM models WHERE slug IN ('deepseek', 'perplexity');
