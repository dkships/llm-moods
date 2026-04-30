CREATE TABLE IF NOT EXISTS public.quota_retry_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  action text NOT NULL,
  status integer,
  response text,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quota_retry_results ENABLE ROW LEVEL SECURITY;