

## Fix Scraped Posts Duplication Bug

### The Problem
27,610 out of 35,743 rows (77%) in `scraped_posts` are duplicates — same `source_url` + `model_id` inserted multiple times. This is skewing all vibe scores and complaint analytics.

### The Fix (Two Steps)

**Step 1 — Delete duplicates (data operation)**
Delete all duplicate rows, keeping the earliest insert per `(source_url, model_id)` pair. This will remove ~27,600 rows.

```sql
DELETE FROM scraped_posts
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY source_url, model_id
      ORDER BY created_at ASC
    ) as rn
    FROM scraped_posts
    WHERE source_url IS NOT NULL
  ) sub
  WHERE rn > 1
);
```

**Step 2 — Add unique constraint (schema migration)**
Prevent future duplicates at the database level with a unique constraint on `(source_url, model_id)`.

```sql
ALTER TABLE scraped_posts
  ADD CONSTRAINT uq_scraped_posts_url_model UNIQUE (source_url, model_id);
```

**Step 3 — Re-aggregate vibes**
After cleanup, trigger the `aggregate-vibes` edge function to recalculate all scores from the cleaned data.

### Impact
- Table shrinks from ~35,700 to ~8,100 rows
- Vibe scores will recalculate based on deduplicated data — expect sentiment distributions to shift significantly
- Future scraper runs will get a DB-level constraint error on duplicates instead of silently inserting (scrapers already have in-memory dedup, so this is a safety net)

### What stays unchanged
- No frontend changes
- No edge function code changes
- No RLS policy changes

