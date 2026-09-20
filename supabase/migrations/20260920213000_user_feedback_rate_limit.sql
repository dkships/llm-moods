-- Rate limit community feedback before it can move the score.
--
-- 20260915120000_user_feedback_source.sql mirrors every submission into
-- scraped_posts as a classified post, where it carries the weight of a
-- low-engagement social post under the default 50% source-share cap. With
-- nothing throttling the anon RPC, a loop of curl calls could supply half of
-- a low-volume model's daily sample (Grok settles at 30-60 eligible posts).
-- The spec left `submitter_hash` for "future rate-limiting"; this is that.
--
-- Two ceilings, both checked inside the SECURITY DEFINER function so the
-- anon role never touches the tables directly:
--   * per submitter hash: SUBMITTER_DAILY_LIMIT submissions per rolling day
--   * per model:          MODEL_HOURLY_LIMIT submissions per rolling hour
-- The hash is client-generated and easy to forge, so the per-model ceiling
-- is the one that actually bounds the damage: at most MODEL_HOURLY_LIMIT
-- rows an hour can enter scoring from this source.

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
  SUBMITTER_DAILY_LIMIT constant integer := 5;
  MODEL_HOURLY_LIMIT    constant integer := 20;
  v_model_id uuid;
  v_feedback_id uuid;
  v_comment text;
  v_complaint text;
  v_recent integer;
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

  -- Rate limits
  IF p_submitter_hash IS NOT NULL THEN
    SELECT count(*) INTO v_recent FROM user_feedback
      WHERE submitter_hash = p_submitter_hash AND created_at > now() - interval '1 day';
    IF v_recent >= SUBMITTER_DAILY_LIMIT THEN
      RAISE EXCEPTION 'Rate limit: too many submissions today';
    END IF;
  END IF;
  SELECT count(*) INTO v_recent FROM user_feedback
    WHERE model_id = v_model_id AND created_at > now() - interval '1 hour';
  IF v_recent >= MODEL_HOURLY_LIMIT THEN
    RAISE EXCEPTION 'Rate limit: this model has received a lot of feedback in the last hour, try again later';
  END IF;

  -- Insert into user_feedback
  INSERT INTO user_feedback (model_id, sentiment, comment, complaint_category, submitter_hash)
  VALUES (v_model_id, p_sentiment, v_comment, v_complaint, p_submitter_hash)
  RETURNING id INTO v_feedback_id;

  -- Mirror into scraped_posts so the scoring pipeline picks it up
  INSERT INTO scraped_posts (
    model_id, source, source_url, title, content, content_type,
    sentiment, complaint_category, confidence, classification_status,
    classified_at, classification_attempts, score, posted_at, created_at
  ) VALUES (
    v_model_id, 'community', NULL, NULL, v_comment, 'comment',
    p_sentiment, v_complaint, 1.0, 'classified',
    now(), 0, 0, now(), now()
  );

  RETURN v_feedback_id;
END;
$$;

REVOKE ALL ON FUNCTION submit_user_feedback FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_user_feedback TO anon, authenticated;
