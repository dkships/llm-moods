SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

REVOKE ALL ON FUNCTION public.get_rumor_candidates(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rumor_candidates(integer) TO service_role;