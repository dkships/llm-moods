-- vendor-status-ingest-6h had failed every run since 2026-10-28 with
-- "ON CONFLICT DO UPDATE command cannot affect row a second time": the xAI
-- feed lists one incident once per affected component (75 events, 30 distinct
-- ids on 2026-11-17). The function runs as one transaction, so that payload
-- also blocked OpenAI and Anthropic and the stale-snapshot cleanup;
-- vendor_incidents recorded nothing new for three weeks.
--
-- Fix: keep one row per incident id per payload (the latest updatedAt), and
-- give each snapshot its own exception block so one bad payload is marked
-- processed (events_seen = -1) instead of aborting every vendor.
-- Applied to production 2026-11-17 via query_database.

CREATE OR REPLACE FUNCTION public.ingest_vendor_status_snapshots()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
DECLARE
  snap     record;
  payload  jsonb;
  ingested integer := 0;
  n        integer;
BEGIN
  FOR snap IN
    SELECT s.request_id, s.vendor, r.status_code, r.content
    FROM public.vendor_status_snapshots s
    JOIN net._http_response r ON r.id = s.request_id
    WHERE s.processed_at IS NULL
  LOOP
    n := 0;
    BEGIN
      IF snap.status_code = 200 THEN
        BEGIN
          payload := snap.content::jsonb;
        EXCEPTION WHEN others THEN
          payload := NULL;
        END;
        IF payload IS NOT NULL AND jsonb_typeof(payload->'events') = 'array' THEN
          WITH events AS (
            SELECT DISTINCT ON (e->>'id') e
            FROM jsonb_array_elements(payload->'events') e
            WHERE e->>'id' IS NOT NULL AND e->>'title' IS NOT NULL AND e->>'updatedAt' IS NOT NULL
            ORDER BY e->>'id', (e->>'updatedAt')::timestamptz DESC
          ), upserted AS (
            INSERT INTO public.vendor_incidents (vendor, external_id, title, severity, summary, url, updated_at)
            SELECT snap.vendor,
                   e->>'id',
                   e->>'title',
                   COALESCE(e->>'severity', 'unknown'),
                   e->>'summary',
                   e->>'url',
                   (e->>'updatedAt')::timestamptz
            FROM events
            ON CONFLICT (vendor, external_id) DO UPDATE
              SET title = EXCLUDED.title,
                  severity = EXCLUDED.severity,
                  summary = EXCLUDED.summary,
                  url = EXCLUDED.url,
                  updated_at = EXCLUDED.updated_at,
                  last_seen_at = now()
            RETURNING 1
          )
          SELECT count(*) INTO n FROM upserted;
        END IF;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'vendor status ingest failed for % (request %): %', snap.vendor, snap.request_id, SQLERRM;
      n := -1;
    END;
    UPDATE public.vendor_status_snapshots
      SET processed_at = now(), status_code = snap.status_code, events_seen = n
      WHERE request_id = snap.request_id;
    ingested := ingested + GREATEST(n, 0);
  END LOOP;

  UPDATE public.vendor_status_snapshots
    SET processed_at = now(), status_code = 0, events_seen = 0
    WHERE processed_at IS NULL AND requested_at < now() - interval '5 hours';
  DELETE FROM public.vendor_status_snapshots WHERE requested_at < now() - interval '14 days';

  RETURN ingested;
END;
$function$;

REVOKE ALL ON FUNCTION public.ingest_vendor_status_snapshots() FROM PUBLIC, anon, authenticated;
