CREATE TABLE public.model_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  tier text NOT NULL DEFAULT 'high',
  context_words text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.model_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read model_keywords" ON public.model_keywords FOR SELECT USING (true);