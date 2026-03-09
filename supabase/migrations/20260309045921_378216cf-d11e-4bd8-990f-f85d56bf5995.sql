DROP POLICY IF EXISTS "Anyone can read user_reports" ON public.user_reports;
DROP POLICY IF EXISTS "Anyone can submit reports" ON public.user_reports;
DROP TABLE IF EXISTS public.user_reports;