# Feature: Community Feedback Page (`/feedback`)

## Summary

Add a new public route `/feedback` where visitors can submit thumbs-up / thumbs-down feedback on an LLM with an optional comment and complaint category. Each submission is stored in a new `user_feedback` table and mirrored into `scraped_posts` with `source = 'community'` so the existing `aggregate-vibes` pipeline picks it up automatically — no scoring code changes needed.

## Why

Community feedback supplements scraped social posts as a data source, especially when scraper volume is low. It gives visitors a way to contribute signal directly rather than waiting for the pipeline to find their posts on Reddit/HN/X.

## Files to create

### 1. `src/hooks/useFeedback.ts`

New hook for submitting and fetching community feedback via two SECURITY DEFINER RPCs.

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FeedbackRow {
  id: string;
  model_id: string;
  model_name: string;
  model_slug: string;
  accent_color: string | null;
  sentiment: string;
  comment: string | null;
  complaint_category: string | null;
  created_at: string;
}

const QUERY_KEY = "user-feedback";

export function useUserFeedback(limit = 30) {
  return useQuery<FeedbackRow[]>({
    queryKey: [QUERY_KEY, limit],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_user_feedback", {
        p_limit: limit,
      });
      if (error) throw error;
      return (data || []) as FeedbackRow[];
    },
  });
}

export interface SubmitFeedbackArgs {
  model_slug: string;
  sentiment: "positive" | "negative";
  comment?: string;
  complaint_category?: string;
}

export function useSubmitFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: SubmitFeedbackArgs) => {
      const { data, error } = await supabase.rpc("submit_user_feedback", {
        p_model_slug: args.model_slug,
        p_sentiment: args.sentiment,
        p_comment: args.comment ?? null,
        p_complaint_category: args.complaint_category ?? null,
        p_submitter_hash: null,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}
```

### 2. `src/pages/Feedback.tsx`

New page component. See full file in the prototype. Key features:
- Model selector using `FilterChip` (reuses `useModelsWithLatestVibes` for the model list)
- Thumbs-up / thumbs-down buttons with `aria-pressed` toggle
- Complaint category chips (shown only for negative sentiment) using the public taxonomy keys
- Optional comment textarea (500 char max, with live remaining count)
- Submit button with loading/success/error states
- Recent feedback feed on the right (uses `useUserFeedback(20)`)
- "How your feedback is used" 3-step explainer at the bottom
- Uses shared primitives: `Surface`, `PageHeader`, `SectionHeader`, `FilterChip`, `Tag`
- Uses type ladder rungs: `text-page`, `text-section`, `text-body`, `text-meta`, `text-mono-cap`
- Sentiment colors: `text-primary` for positive, `text-destructive-text` for negative

### 3. Supabase migration: `20260915120000_user_feedback_source.sql`

```sql
/*
# User Feedback — community sentiment submissions

## Purpose
Adds a new "community" data source. Visitors submit thumbs-up / thumbs-down
feedback on an LLM with an optional comment. Each submission is stored in
`user_feedback` AND mirrored into `scraped_posts` with source = 'community'
so the existing scoring pipeline picks it up automatically.

## New Tables
- `user_feedback`: id, model_id (FK→models), sentiment ('positive'|'negative'),
  comment (≤500 chars), complaint_category, submitter_hash, created_at

## New Functions (SECURITY DEFINER)
- `submit_user_feedback(p_model_slug, p_sentiment, p_comment, p_complaint_category, p_submitter_hash)`
  Validates inputs, looks up model by slug, inserts into user_feedback + scraped_posts
  (source='community', confidence=1.0, classification_status='classified').
  Returns the new feedback UUID.
- `get_public_user_feedback(p_limit)` — recent feedback joined with model info.

## Security
- RLS on user_feedback: anon+authenticated SELECT and INSERT only (no UPDATE/DELETE).
- SECURITY DEFINER functions bypass RLS on scraped_posts (no anon INSERT policy).
- EXECUTE revoked from PUBLIC; granted to anon+authenticated explicitly.
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
  IF p_sentiment NOT IN ('positive', 'negative') THEN
    RAISE EXCEPTION 'Invalid sentiment: must be positive or negative';
  END IF;

  v_comment := NULLIF(TRIM(COALESCE(p_comment, '')), '');
  IF v_comment IS NOT NULL AND char_length(v_comment) > 500 THEN
    RAISE EXCEPTION 'Comment exceeds 500 characters';
  END IF;

  IF p_sentiment = 'positive' THEN
    v_complaint := NULL;
  ELSE
    v_complaint := NULLIF(TRIM(COALESCE(p_complaint_category, '')), '');
  END IF;

  SELECT id INTO v_model_id FROM models WHERE slug = p_model_slug LIMIT 1;
  IF v_model_id IS NULL THEN
    RAISE EXCEPTION 'Model not found: %', p_model_slug;
  END IF;

  INSERT INTO user_feedback (model_id, sentiment, comment, complaint_category, submitter_hash)
  VALUES (v_model_id, p_sentiment, v_comment, v_complaint, p_submitter_hash)
  RETURNING id INTO v_feedback_id;

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

CREATE OR REPLACE FUNCTION get_public_user_feedback(
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid, model_id uuid, model_name text, model_slug text,
  accent_color text, sentiment text, comment text,
  complaint_category text, created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    uf.id, uf.model_id, m.name AS model_name, m.slug AS model_slug,
    m.accent_color, uf.sentiment, uf.comment,
    uf.complaint_category, uf.created_at
  FROM user_feedback uf
  JOIN models m ON m.id = uf.model_id
  ORDER BY uf.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

REVOKE ALL ON FUNCTION get_public_user_feedback FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_user_feedback TO anon, authenticated;
```

## Files to modify

### `src/App.tsx`
- Add `const Feedback = lazy(() => import("./pages/Feedback"));`
- Add `<Route path="feedback" element={<Feedback />} />` inside the public layout routes

### `src/components/NavBar.tsx`
- Add `const isFeedbackActive = pathname === "/feedback";`
- Add a nav link: `<Link to="/feedback" className={navLinkClass(isFeedbackActive)}>Feedback</Link>` after the Rumors link

### `scripts/prerender-routes.ts`
- Add a new route entry to the `indexes` array:
```typescript
{
  path: "/feedback",
  title: "Share Your Feedback — LLM Vibes",
  description: "Rate your experience with Claude, ChatGPT, Gemini, or Grok. Your thumbs-up or thumbs-down feeds directly into the community sentiment score.",
  ogImage: defaultOgImage,
  ogType: "website",
},
```

### `public/sitemap.xml`
- Add before the `/privacy` entry:
```xml
<url>
  <loc>https://llmvibes.ai/feedback</loc>
  <changefreq>daily</changefreq>
  <priority>0.7</priority>
</url>
```

## Design decisions

1. **Mirrors into `scraped_posts`** rather than requiring scoring pipeline changes — `source = 'community'` flows through `aggregate-vibes` with the default 50% source-share cap.
2. **`confidence = 1.0`** — user explicitly chose the sentiment, no AI classification needed.
3. **`score = 0`** (engagement metric) — the engagement multiplier floors at 1.0, giving community feedback the weight of a low-engagement social post. A handful of votes supplement scraped data without dominating it.
4. **SECURITY DEFINER functions** — the anon role has no INSERT policy on `scraped_posts`, so the RPC bypasses RLS to mirror the row. The `user_feedback` table itself has direct anon INSERT/SELECT policies.
5. **No auth required** — this is a no-auth public app. The `submitter_hash` column is reserved for future rate-limiting (fingerprint-based, not user accounts).
6. **Complaint categories** use the same public taxonomy keys (`src/shared/public-taxonomy.ts`) the rest of the site uses — no new categories invented.

## Public route inventory update

Add `/feedback` to the fixed public route inventory in `CLAUDE.md` and `AGENTS.md`:
- Current: `/`, `/dashboard`, `/model/:slug`, `/compare`, `/benchmark`, `/research`, `/research/:slug`, `/rumors`, `/privacy`, `*`
- New: add `/feedback` before `/privacy`

## Checklist

- [ ] Create `src/hooks/useFeedback.ts`
- [ ] Create `src/pages/Feedback.tsx`
- [ ] Apply the Supabase migration
- [ ] Wire up route in `src/App.tsx`
- [ ] Add nav link in `src/components/NavBar.tsx`
- [ ] Add prerender route in `scripts/prerender-routes.ts`
- [ ] Add sitemap entry in `public/sitemap.xml`
- [ ] Update public route inventory in `CLAUDE.md` + `AGENTS.md`
- [ ] Build passes (`npm run build`)
- [ ] Tests pass (`npm run test`)
