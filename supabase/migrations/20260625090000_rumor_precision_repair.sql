-- Rumor precision repair: merge Gemini 3.5 Pro aliases, correct the GPT-5.6
-- delay row to the tracked synthwavedd source, and reopen affected source URLs
-- for reprocessing by the hardened aggregate-rumors function.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Merge existing Gemini duplicate rows ("3.5 Pro" / "Gemini 3.5 Pro") into the
-- canonical key now used by _shared/rumor-canon.ts.
WITH candidates AS (
  SELECT *
  FROM public.model_rumors
  WHERE model_slug = 'gemini'
    AND (
      version_key IN ('35pro', 'gemini35pro')
      OR lower(regexp_replace(COALESCE(version_label, ''), '[^a-z0-9]+', '', 'g')) IN ('35pro', 'gemini35pro')
    )
),
lead AS (
  SELECT *
  FROM candidates
  ORDER BY CASE claim_type
      WHEN 'delayed' THEN 6
      WHEN 'return' THEN 5
      WHEN 'imminent' THEN 4
      WHEN 'in_testing' THEN 3
      WHEN 'launch' THEN 2
      ELSE 1
    END DESC,
    has_credible_source DESC,
    last_seen_at DESC NULLS LAST,
    mention_count DESC
  LIMIT 1
),
source_items AS (
  SELECT DISTINCT ON (url)
    url,
    src,
    CASE src->>'source_quality'
      WHEN 'official' THEN 5
      WHEN 'tracked_leaker' THEN 4
      WHEN 'artifact_leak' THEN 3
      WHEN 'prediction_market' THEN 2
      WHEN 'press_echo' THEN 1
      ELSE 0
    END AS quality_rank,
    COALESCE(NULLIF(src->>'score', '')::integer, 0) AS score
  FROM candidates c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.representative_sources, '[]'::jsonb)) src
  CROSS JOIN LATERAL (SELECT NULLIF(src->>'url', '') AS url) u
  WHERE url IS NOT NULL
  ORDER BY url, quality_rank DESC, score DESC
),
visible_sources AS (
  SELECT COUNT(*)::integer AS visible_url_count
  FROM source_items
),
top_sources AS (
  SELECT src, quality_rank, score
  FROM source_items
  ORDER BY quality_rank DESC, score DESC
  LIMIT 4
),
merged_sources AS (
  SELECT COALESCE(jsonb_agg(src ORDER BY quality_rank DESC, score DESC), '[]'::jsonb) AS representative_sources
  FROM top_sources
),
row_rep_counts AS (
  SELECT
    c.id,
    COUNT(DISTINCT NULLIF(src->>'url', ''))::integer AS rep_count
  FROM candidates c
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(c.representative_sources, '[]'::jsonb)) src ON true
  GROUP BY c.id
),
hidden_mentions AS (
  SELECT COALESCE(SUM(GREATEST(c.mention_count - COALESCE(rr.rep_count, 0), 0)), 0)::integer AS hidden_count
  FROM candidates c
  LEFT JOIN row_rep_counts rr ON rr.id = c.id
),
platform_values AS (
  SELECT unnest(COALESCE(platforms, '{}'::text[])) AS platform
  FROM candidates
  UNION
  SELECT NULLIF(src->>'platform', '') AS platform
  FROM source_items
),
merged_platforms AS (
  SELECT COALESCE(array_agg(DISTINCT platform ORDER BY platform) FILTER (WHERE platform IS NOT NULL), '{}'::text[]) AS platforms
  FROM platform_values
),
eta_values AS (
  SELECT
    COUNT(DISTINCT lower(NULLIF(eta_text, ''))) FILTER (WHERE NULLIF(eta_text, '') IS NOT NULL) AS eta_text_count,
    COUNT(DISTINCT eta_date) FILTER (WHERE eta_date IS NOT NULL) AS eta_date_count
  FROM candidates
)
INSERT INTO public.model_rumors (
  model_slug,
  version_key,
  version_label,
  codename,
  claim_type,
  claim_summary,
  rumored_benefit,
  benefit_verified,
  signals,
  eta_text,
  eta_date,
  eta_conflicting,
  mention_count,
  platforms,
  representative_sources,
  has_credible_source,
  first_seen_at,
  last_seen_at,
  updated_at
)
SELECT
  'gemini',
  'gemini35pro',
  'Gemini 3.5 Pro',
  NULL::text,
  lead.claim_type,
  lead.claim_summary,
  lead.rumored_benefit,
  lead.benefit_verified,
  lead.signals,
  lead.eta_text,
  lead.eta_date,
  bool_or(candidates.eta_conflicting) OR eta_values.eta_text_count > 1 OR eta_values.eta_date_count > 1,
  visible_sources.visible_url_count + hidden_mentions.hidden_count,
  merged_platforms.platforms,
  merged_sources.representative_sources,
  bool_or(candidates.has_credible_source),
  min(candidates.first_seen_at),
  max(candidates.last_seen_at),
  now()
FROM candidates
CROSS JOIN lead
CROSS JOIN visible_sources
CROSS JOIN hidden_mentions
CROSS JOIN merged_platforms
CROSS JOIN merged_sources
CROSS JOIN eta_values
GROUP BY
  lead.claim_type,
  lead.claim_summary,
  lead.rumored_benefit,
  lead.benefit_verified,
  lead.signals,
  lead.eta_text,
  lead.eta_date,
  visible_sources.visible_url_count,
  hidden_mentions.hidden_count,
  merged_platforms.platforms,
  merged_sources.representative_sources,
  eta_values.eta_text_count,
  eta_values.eta_date_count
ON CONFLICT (model_slug, version_key) DO UPDATE
SET version_label = EXCLUDED.version_label,
    codename = EXCLUDED.codename,
    claim_type = EXCLUDED.claim_type,
    claim_summary = EXCLUDED.claim_summary,
    rumored_benefit = EXCLUDED.rumored_benefit,
    benefit_verified = EXCLUDED.benefit_verified,
    signals = EXCLUDED.signals,
    eta_text = EXCLUDED.eta_text,
    eta_date = EXCLUDED.eta_date,
    eta_conflicting = EXCLUDED.eta_conflicting,
    mention_count = EXCLUDED.mention_count,
    platforms = EXCLUDED.platforms,
    representative_sources = EXCLUDED.representative_sources,
    has_credible_source = EXCLUDED.has_credible_source,
    first_seen_at = EXCLUDED.first_seen_at,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = now();

DELETE FROM public.model_rumors
WHERE model_slug = 'gemini'
  AND version_key <> 'gemini35pro'
  AND (
    version_key IN ('35pro', 'gemini35pro')
    OR lower(regexp_replace(COALESCE(version_label, ''), '[^a-z0-9]+', '', 'g')) IN ('35pro', 'gemini35pro')
  );

-- Correct GPT-5.6 to the stronger tracked-leaker delay source. Existing sources
-- stay after synthwavedd, capped to the same four representative refs the edge
-- function writes.
WITH scraped_source AS (
  SELECT source_url, posted_at, score, author_verified, author_followers
  FROM public.scraped_posts
  WHERE COALESCE(source_url, '') LIKE '%2069432791184650426%'
  ORDER BY posted_at DESC NULLS LAST
  LIMIT 1
),
synth_source AS (
  SELECT
    jsonb_strip_nulls(jsonb_build_object(
      'url', 'https://x.com/synthwavedd/status/2069432791184650426',
      'handle', 'synthwavedd',
      'platform', 'twitter',
      'source_quality', 'tracked_leaker',
      'posted_at', COALESCE((SELECT posted_at::text FROM scraped_source), now()::text),
      'score', (SELECT score FROM scraped_source),
      'verified', (SELECT author_verified FROM scraped_source),
      'followers', (SELECT author_followers FROM scraped_source)
    )) AS source_ref,
    COALESCE((SELECT posted_at FROM scraped_source), now()) AS source_posted_at
),
existing_target AS (
  SELECT *
  FROM public.model_rumors
  WHERE model_slug = 'chatgpt'
    AND version_key = 'gpt56'
  LIMIT 1
),
source_seen AS (
  SELECT EXISTS (
    SELECT 1
    FROM existing_target e
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.representative_sources, '[]'::jsonb)) src
    WHERE COALESCE(src->>'url', '') LIKE '%2069432791184650426%'
  ) AS was_present
),
existing_source_items AS (
  SELECT src, ord
  FROM existing_target e
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.representative_sources, '[]'::jsonb)) WITH ORDINALITY AS s(src, ord)
  WHERE COALESCE(src->>'url', '') NOT LIKE '%2069432791184650426%'
),
source_items AS (
  SELECT source_ref AS src, 0 AS sort_rank, 0::bigint AS ord
  FROM synth_source
  UNION ALL
  SELECT src, 1 AS sort_rank, ord
  FROM existing_source_items
),
top_sources AS (
  SELECT src, sort_rank, ord
  FROM source_items
  ORDER BY sort_rank, ord
  LIMIT 4
),
merged_sources AS (
  SELECT COALESCE(jsonb_agg(src ORDER BY sort_rank, ord), '[]'::jsonb) AS representative_sources
  FROM top_sources
)
INSERT INTO public.model_rumors (
  model_slug,
  version_key,
  version_label,
  codename,
  claim_type,
  claim_summary,
  rumored_benefit,
  benefit_verified,
  signals,
  eta_text,
  eta_date,
  eta_conflicting,
  mention_count,
  platforms,
  representative_sources,
  has_credible_source,
  first_seen_at,
  last_seen_at,
  updated_at
)
SELECT
  'chatgpt',
  'gpt56',
  'GPT-5.6',
  NULL::text,
  'delayed',
  'GPT-5.6 is delayed to mid-July.',
  e.rumored_benefit,
  COALESCE(e.benefit_verified, false),
  COALESCE(e.signals, 'Tracked leaker delay claim'),
  'mid-July',
  NULL::date,
  COALESCE(e.eta_conflicting, false)
    OR (NULLIF(lower(COALESCE(e.eta_text, '')), '') IS NOT NULL AND lower(COALESCE(e.eta_text, '')) <> 'mid-july')
    OR e.eta_date IS NOT NULL,
  GREATEST(COALESCE(e.mention_count, 0) + CASE WHEN source_seen.was_present THEN 0 ELSE 1 END, 1),
  ARRAY(
    SELECT DISTINCT platform
    FROM (
      SELECT unnest(COALESCE(e.platforms, '{}'::text[])) AS platform
      UNION ALL
      SELECT 'twitter'
    ) p
    WHERE platform IS NOT NULL
    ORDER BY platform
  ),
  merged_sources.representative_sources,
  true,
  LEAST(COALESCE(e.first_seen_at, synth_source.source_posted_at), synth_source.source_posted_at),
  GREATEST(COALESCE(e.last_seen_at, synth_source.source_posted_at), synth_source.source_posted_at),
  now()
FROM synth_source
CROSS JOIN source_seen
CROSS JOIN merged_sources
LEFT JOIN existing_target e ON true
ON CONFLICT (model_slug, version_key) DO UPDATE
SET version_label = EXCLUDED.version_label,
    codename = EXCLUDED.codename,
    claim_type = EXCLUDED.claim_type,
    claim_summary = EXCLUDED.claim_summary,
    rumored_benefit = COALESCE(model_rumors.rumored_benefit, EXCLUDED.rumored_benefit),
    benefit_verified = model_rumors.benefit_verified OR EXCLUDED.benefit_verified,
    signals = COALESCE(EXCLUDED.signals, model_rumors.signals),
    eta_text = EXCLUDED.eta_text,
    eta_date = EXCLUDED.eta_date,
    eta_conflicting = EXCLUDED.eta_conflicting,
    mention_count = EXCLUDED.mention_count,
    platforms = EXCLUDED.platforms,
    representative_sources = EXCLUDED.representative_sources,
    has_credible_source = true,
    first_seen_at = EXCLUDED.first_seen_at,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = now();

WITH affected_urls(url) AS (
  VALUES
    ('https://x.com/synthwavedd/status/2069432791184650426'),
    ('https://twitter.com/synthwavedd/status/2069432791184650426'),
    ('https://www.reddit.com/r/singularity/comments/1udjf57/june_delays_56/'),
    ('https://old.reddit.com/r/singularity/comments/1udjf57/june_delays_56/'),
    ('https://digg.com/tech/6hp5va4b'),
    ('https://claudedown.com/')
  UNION
  SELECT DISTINCT src->>'url'
  FROM public.model_rumors r
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.representative_sources, '[]'::jsonb)) src
  WHERE r.model_slug = 'gemini'
    AND r.version_key = 'gemini35pro'
    AND NULLIF(src->>'url', '') IS NOT NULL
)
UPDATE public.scraped_posts sp
SET rumor_checked_at = NULL,
    rumor_data = NULL,
    quoted_status_id = CASE
      WHEN COALESCE(sp.source_url, '') LIKE '%2069432791184650426%' THEN sp.quoted_status_id
      WHEN COALESCE(sp.title, '') || ' ' || COALESCE(sp.content, '') LIKE '%2069432791184650426%' THEN '2069432791184650426'
      ELSE sp.quoted_status_id
    END
WHERE COALESCE(sp.source_url, '') IN (SELECT url FROM affected_urls)
   OR COALESCE(sp.source_url, '') LIKE '%2069432791184650426%'
   OR COALESCE(sp.source_url, '') LIKE '%/comments/1udjf57/%'
   OR COALESCE(sp.source_url, '') LIKE '%digg.com/tech/6hp5va4b%'
   OR COALESCE(sp.source_url, '') LIKE '%claudedown.com%'
   OR COALESCE(sp.title, '') || ' ' || COALESCE(sp.content, '') LIKE '%2069432791184650426%'
   OR (
     EXISTS (
       SELECT 1
       FROM public.models m
       WHERE m.id = sp.model_id
         AND m.slug = 'gemini'
     )
     AND (
       COALESCE(sp.title, '') ILIKE '%3.5 Pro%'
       OR COALESCE(sp.content, '') ILIKE '%3.5 Pro%'
       OR COALESCE(sp.rumor_data::text, '') ILIKE '%3.5 Pro%'
     )
   );
