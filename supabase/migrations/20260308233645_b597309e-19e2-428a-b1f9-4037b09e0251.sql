
CREATE TABLE public.error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  error_message text NOT NULL,
  context text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read error_log" ON public.error_log FOR SELECT USING (true);
