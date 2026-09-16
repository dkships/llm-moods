/*
# User Feedback — community sentiment submissions

## Purpose
Adds a new "community" data source alongside the existing scrapers. Visitors
can submit thumbs-up / thumbs-down feedback on an LLM with an optional comment.
Each submission is stored in a dedicated `user_feedback` table AND mirrored into
`scraped_posts` with `source = 'community'` so the existing scoring pipeline
(aggregate-vibes, computeScore) picks it up automatically without any changes
to the scorer or cron jobs.

## New Tables
- `user_feedback`
  - `id` (uuid, PK, default gen_random_uuid())
  - `model_id` (uuid, FK → models.id ON DELETE CASCADE)
  - `sentiment` (text, NOT NULL — 'positive' or 'negative')
  - `comment` (text, nullable, max 500 chars — optional user comment)
  - `complaint_category` (text, nullable — set only for negative sentiment)
  - `submitter_hash` (text, nullable — client-generated fingerprint for future rate-limiting)
  - `created_at` (timestamptz, default now())

## New Functions (SECURITY DEFINER)
- `submit_user_feedback(p_model_slug, p_sentiment, p_comment, p_complaint_category, p_submitter_hash)`
  Validates inputs, looks up the model by slug, inserts into `user_feedback`,
  and mirrors the row into `scraped_posts` with:
    - source = 'community'
    - sentiment = 'positive' or 'negative'
    - confidence = 1.0 (user explicitly chose the sentiment)
    - classification_status = 'classified'
    - content_type = 'comment'
    - score = 0 (no engagement metric — engagement multiplier floors at 1.0)
  Returns the new feedback UUID. Callable by anon and authenticated.
  Revokes EXECUTE from public; grants to anon + authenticated explicitly.

- `get_public_user_feedback(p_limit)`
  Returns the most recent feedback rows joined with model name/slug/accent_color.
  Callable by anon and authenticated.

## Security
- RLS enabled on `user_feedback`.
- SELECT + INSERT policies for anon, authenticated (no-auth public app —
  feedback is intentionally shared/public data).
- No UPDATE or DELETE policies — submissions are immutable once posted.
- SECURITY DEFINER functions bypass RLS on scraped_posts (which has no INSERT
  policy for anon) so community feedback can be mirrored into the scoring table.

## Important Notes
1. The `community` source is NOT in SCORE_EXCLUDED_SOURCES, so it flows into
   the sentiment score with the default 50% source-share cap.
2. Each community feedback post has confidence = 1.0 and engagement = 1.0
   (score=0 → log(1) = 0, floored at 1.0), giving it the weight of a
   low-engagement social post — intentional so a handful of community
   votes can supplement scraped data without dominating it.
3. complaint_category is only stored for negative feedback; positive feedback
   leaves it NULL, consistent with how the classifier assigns complaints.
*/

CREATE TABLE IF NOT EXISTS user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  sentiment text NOT NULL CHECK (sentiment IN ('positive', 'negative')),
  comment text CHECK (char_length(comment) <= 500),
  complaint_category text,
  submitter_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_user_feedback" ON user_feedback;
CREATE POLICY "anon_select_user_feedback"
ON user_feedback FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_user_feedback" ON user_feedback;
CREATE POLICY "anon_insert_user_feedback"
ON user_feedback FOR INSERT
TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at
ON user_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_feedback_model_id
ON user_feedback (model_id);

-- -----------------------------------------------------------------------
-- submit_user_feedback: insert into user_feedback + mirror into scraped_posts
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_user_feedback(
  p_model_slug text,
  p_sentiment text,
  p_comment text DEFAULT NULL,
  p_complaint_category text DEFAULT NULL,
  p_submitter_hash text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model_id uuid;
  v_feedback_id uuid;
  v_comment text;
  v_complaint text;
BEGIN
  -- Validate sentiment
  IF p_sentiment NOT IN ('positive', 'negative') THEN
    RAISE EXCEPTION 'Invalid sentiment: must be positive or negative';
  END IF;

  -- Trim and validate comment
  v_comment := NULLIF(TRIM(COALESCE(p_comment, '')), '');
  IF v_comment IS NOT NULL AND char_length(v_comment) > 500 THEN
    RAISE EXCEPTION 'Comment exceeds 500 characters';
  END IF;

  -- Complaint category only for negative sentiment
  IF p_sentiment = 'positive' THEN
    v_complaint := NULL;
  ELSE
    v_complaint := NULLIF(TRIM(COALESCE(p_complaint_category, '')), '');
  END IF;

  -- Look up model by slug
  SELECT id INTO v_model_id FROM models WHERE slug = p_model_slug LIMIT 1;
  IF v_model_id IS NULL THEN
    RAISE EXCEPTION 'Model not found: %', p_model_slug;
  END IF;

  -- Insert into user_feedback
  INSERT INTO user_feedback (model_id, sentiment, comment, complaint_category, submitter_hash)
  VALUES (v_model_id, p_sentiment, v_comment, v_complaint, p_submitter_hash)
  RETURNING id INTO v_feedback_id;

  -- Mirror into scraped_posts so the scoring pipeline picks it up
  INSERT INTO scraped_posts (
    model_id,
    source,
    source_url,
    title,
    content,
    content_type,
    sentiment,
    complaint_category,
    confidence,
    classification_status,
    classified_at,
    classification_attempts,
    score,
    posted_at,
    created_at
  ) VALUES (
    v_model_id,
    'community',
    NULL,
    NULL,
    v_comment,
    'comment',
    p_sentiment,
    v_complaint,
    1.0,
    'classified',
    now(),
    0,
    0,
    now(),
    now()
  );

  RETURN v_feedback_id;
END;
$$;

REVOKE ALL ON FUNCTION submit_user_feedback FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_user_feedback TO anon, authenticated;

-- -----------------------------------------------------------------------
-- get_public_user_feedback: recent feedback for the community feed
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_public_user_feedback(
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  model_id uuid,
  model_name text,
  model_slug text,
  accent_color text,
  sentiment text,
  comment text,
  complaint_category text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    uf.id,
    uf.model_id,
    m.name AS model_name,
    m.slug AS model_slug,
    m.accent_color,
    uf.sentiment,
    uf.comment,
    uf.complaint_category,
    uf.created_at
  FROM user_feedback uf
  JOIN models m ON m.id = uf.model_id
  ORDER BY uf.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

REVOKE ALL ON FUNCTION get_public_user_feedback FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_user_feedback TO anon, authenticated;