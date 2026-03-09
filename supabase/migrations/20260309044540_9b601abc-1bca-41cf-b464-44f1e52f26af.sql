CREATE TABLE public.scraper_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper text NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scraper, key, value)
);

ALTER TABLE public.scraper_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read scraper_config" ON public.scraper_config FOR SELECT USING (true);