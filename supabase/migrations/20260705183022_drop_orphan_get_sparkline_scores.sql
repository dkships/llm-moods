-- get_sparkline_scores() was superseded by get_public_vibes_sparkline() in the
-- public-RPC security hardening; nothing calls it (no client .rpc(), no SQL body,
-- no edge function, no cron).
DROP FUNCTION public.get_sparkline_scores();
