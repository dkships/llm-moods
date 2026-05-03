-- Quality pipeline: preserve classifier-deferred candidates, expose score
-- confidence/coverage, and keep public reads aggregated.

CREATE TABLE IF NOT EXISTS public.classification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  scraper_source text NOT NULL,
  model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  model_slug text NOT NULL,
  source_url text NOT NULL,
  title text,
  content text,
  full_text text NOT NULL,
  content_type text NOT NULL DEFAULT 'title_and_body',
  score integer NOT NULL DEFAULT 0,
  posted_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'retrying', 'classified', 'irrelevant', 'failed', 'duplicate')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  last_error_type text,
  request_error_id text,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_url, model_id)
);

ALTER TABLE public.classification_queue ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_classification_queue_status_next_attempt
  ON public.classification_queue(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_classification_queue_model_posted_at
  ON public.classification_queue(model_id, posted_at DESC);

ALTER TABLE public.vibes_scores
  ADD COLUMN IF NOT EXISTS queued_posts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unclassified_posts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS classification_coverage numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS score_confidence text NOT NULL DEFAULT 'high'
    CHECK (score_confidence IN ('high', 'medium', 'low'));

ALTER TABLE public.vibes_scores
  DROP CONSTRAINT IF EXISTS vibes_scores_score_basis_status_check;

ALTER TABLE public.vibes_scores
  ADD CONSTRAINT vibes_scores_score_basis_status_check
  CHECK (score_basis_status IN ('measured', 'thin_sample', 'no_eligible_posts', 'carried_forward', 'partial_coverage'));

CREATE OR REPLACE FUNCTION public.get_classification_queue_health()
RETURNS TABLE(
  queued integer,
  retrying integer,
  failed integer,
  oldest_queued_at timestamptz,
  next_attempt_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(*) FILTER (WHERE status = 'queued')::integer AS queued,
    COUNT(*) FILTER (WHERE status = 'retrying')::integer AS retrying,
    COUNT(*) FILTER (WHERE status = 'failed')::integer AS failed,
    MIN(created_at) FILTER (WHERE status IN ('queued', 'retrying')) AS oldest_queued_at,
    MIN(next_attempt_at) FILTER (WHERE status IN ('queued', 'retrying')) AS next_attempt_at
  FROM public.classification_queue;
$function$;

GRANT EXECUTE ON FUNCTION public.get_classification_queue_health() TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_landing_vibes();
CREATE OR REPLACE FUNCTION public.get_landing_vibes()
RETURNS TABLE(
  model_id uuid,
  model_name text,
  model_slug text,
  accent_color text,
  latest_score integer,
  previous_score integer,
  total_posts integer,
  top_complaint text,
  eligible_posts integer,
  last_updated timestamptz,
  score_computed_at timestamptz,
  score_period_start timestamptz,
  score_period_end timestamptz,
  latest_score_total_posts integer,
  latest_score_eligible_posts integer,
  recent_posts_7d integer,
  latest_post_posted_at timestamptz,
  latest_post_ingested_at timestamptz,
  score_basis_status text,
  measurement_period_start timestamptz,
  carried_from_period_start timestamptz,
  queued_posts integer,
  unclassified_posts integer,
  classification_coverage numeric,
  score_confidence text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ranked AS (
    SELECT
      vs.model_id,
      vs.score,
      vs.total_posts,
      vs.eligible_posts,
      vs.top_complaint,
      vs.period_start,
      vs.score_computed_at,
      vs.score_basis_status,
      vs.measurement_period_start,
      vs.carried_from_period_start,
      vs.queued_posts,
      vs.unclassified_posts,
      vs.classification_coverage,
      vs.score_confidence,
      ROW_NUMBER() OVER (PARTITION BY vs.model_id ORDER BY vs.period_start DESC) AS rn
    FROM public.vibes_scores vs
    WHERE vs.period = 'daily'
      AND vs.period_start > (now() - interval '14 days')
  ),
  recent_posts AS (
    SELECT
      model_id,
      COUNT(*)::integer AS recent_posts_7d,
      MAX(posted_at) AS latest_post_posted_at,
      MAX(created_at) AS latest_post_ingested_at
    FROM public.scraped_posts
    WHERE posted_at > (now() - interval '7 days')
    GROUP BY model_id
  )
  SELECT
    m.id AS model_id,
    m.name AS model_name,
    m.slug AS model_slug,
    m.accent_color,
    COALESCE(r1.score, 50) AS latest_score,
    r2.score AS previous_score,
    COALESCE(rp.recent_posts_7d, 0) AS total_posts,
    r1.top_complaint,
    COALESCE(r1.eligible_posts, 0) AS eligible_posts,
    r1.score_computed_at AS last_updated,
    r1.score_computed_at,
    r1.period_start AS score_period_start,
    CASE WHEN r1.period_start IS NOT NULL THEN r1.period_start + interval '1 day' ELSE NULL END AS score_period_end,
    COALESCE(r1.total_posts, 0) AS latest_score_total_posts,
    COALESCE(r1.eligible_posts, 0) AS latest_score_eligible_posts,
    COALESCE(rp.recent_posts_7d, 0) AS recent_posts_7d,
    rp.latest_post_posted_at,
    rp.latest_post_ingested_at,
    COALESCE(r1.score_basis_status, 'stale_no_current_score') AS score_basis_status,
    r1.measurement_period_start,
    r1.carried_from_period_start,
    COALESCE(r1.queued_posts, 0) AS queued_posts,
    COALESCE(r1.unclassified_posts, 0) AS unclassified_posts,
    COALESCE(r1.classification_coverage, 1.0) AS classification_coverage,
    COALESCE(r1.score_confidence, 'low') AS score_confidence
  FROM public.models m
  LEFT JOIN ranked r1 ON r1.model_id = m.id AND r1.rn = 1
  LEFT JOIN ranked r2 ON r2.model_id = m.id AND r2.rn = 2
  LEFT JOIN recent_posts rp ON rp.model_id = m.id
  ORDER BY m.name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_landing_vibes() TO anon, authenticated;