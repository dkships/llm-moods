-- get_rumor_candidates exposes raw scraped post text and is called only by the
-- aggregate-rumors Edge Function. Revoke role-specific grants explicitly: a
-- PUBLIC-only revoke did not remove the anon/authenticated grants in production.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

REVOKE ALL ON FUNCTION public.get_rumor_candidates(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rumor_candidates(integer) TO service_role;
