ALTER TABLE public.scraped_posts
  ADD COLUMN IF NOT EXISTS original_language TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS translated_content TEXT DEFAULT NULL;
