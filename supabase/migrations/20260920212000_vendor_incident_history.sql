-- Vendor incident history: keep official status-page incidents so downtime
-- can be lined up against the score after the fact.
--
-- `fetch-vendor-status` already parses Anthropic + OpenAI Atom feeds and
-- Google's incidents.json, but it only returns the trailing ~30 days and
-- nothing stores the result. A research piece written in November about a
-- September degradation had no incident record to point at. This migration
-- snapshots the feed every six hours into `vendor_incidents` and exposes it
-- through a public RPC; the model-page chart keeps using the live feed for
-- freshness, and pinned research charts read history from here.
--
-- SQL only — no edge-function deploy. pg_net's http_post is asynchronous, so
-- two cron rows run five minutes apart: one enqueues a request per vendor and
-- records the request id, the next reads net._http_response and upserts the
-- events. xAI publishes no status feed and is skipped.
--
-- As with 20260822130000, the anon bearer is copied from an existing cron
-- row at apply time so no key appears in this public migration.

CREATE TABLE IF NOT EXISTS public.vendor_incidents (
  vendor        text NOT NULL,
  external_id   text NOT NULL,
  title         text NOT NULL,
  severity      text NOT NULL,
  summary       text,
  url           text,
  updated_at    timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor, external_id)
);
CREATE INDEX IF NOT EXISTS idx_vendor_incidents_vendor_updated
  ON public.vendor_incidents (vendor, updated_at DESC);
ALTER TABLE public.vendor_incidents ENABLE ROW LEVEL SECURITY;

-- Pending pg_net requests, matched to their responses by the ingest job.
CREATE TABLE IF NOT EXISTS public.vendor_status_snapshots (
  request_id   bigint PRIMARY KEY,
  vendor       text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status_code  integer,
  events_seen  integer
);
ALTER TABLE public.vendor_status_snapshots ENABLE ROW LEVEL SECURITY;

-- Reads the responses that arrived since the last pass and upserts events.
-- pg_net keeps responses for ~6 hours, so the ingest cron runs a few minutes
-- after each request cron and never waits a full cycle.
CREATE OR REPLACE FUNCTION public.ingest_vendor_status_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
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
    IF snap.status_code = 200 THEN
      BEGIN
        payload := snap.content::jsonb;
      EXCEPTION WHEN others THEN
        payload := NULL;
      END;
      IF payload IS NOT NULL AND jsonb_typeof(payload->'events') = 'array' THEN
        WITH upserted AS (
          INSERT INTO public.vendor_incidents (vendor, external_id, title, severity, summary, url, updated_at)
          SELECT snap.vendor,
                 e->>'id',
                 e->>'title',
                 COALESCE(e->>'severity', 'unknown'),
                 e->>'summary',
                 e->>'url',
                 (e->>'updatedAt')::timestamptz
          FROM jsonb_array_elements(payload->'events') e
          WHERE e->>'id' IS NOT NULL AND e->>'title' IS NOT NULL AND e->>'updatedAt' IS NOT NULL
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
    UPDATE public.vendor_status_snapshots
      SET processed_at = now(), status_code = snap.status_code, events_seen = n
      WHERE request_id = snap.request_id;
    ingested := ingested + n;
  END LOOP;

  -- Requests whose response expired unprocessed, and old bookkeeping rows.
  UPDATE public.vendor_status_snapshots
    SET processed_at = now(), status_code = 0, events_seen = 0
    WHERE processed_at IS NULL AND requested_at < now() - interval '5 hours';
  DELETE FROM public.vendor_status_snapshots WHERE requested_at < now() - interval '14 days';

  RETURN ingested;
END;
$$;
REVOKE ALL ON FUNCTION public.ingest_vendor_status_snapshots() FROM PUBLIC;

-- Public read: incidents for one vendor inside a window. Used by charts to
-- draw incident markers over any historical range.
CREATE OR REPLACE FUNCTION public.get_public_vendor_incidents(
  p_vendor text,
  p_since timestamptz,
  p_until timestamptz DEFAULT now()
)
RETURNS TABLE (
  external_id text,
  title text,
  severity text,
  summary text,
  url text,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT vi.external_id, vi.title, vi.severity, vi.summary, vi.url, vi.updated_at
  FROM public.vendor_incidents vi
  WHERE vi.vendor = p_vendor
    AND vi.updated_at >= p_since
    AND vi.updated_at < p_until
  ORDER BY vi.updated_at DESC
  LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public.get_public_vendor_incidents(text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_vendor_incidents(text, timestamptz, timestamptz) TO anon, authenticated;

-- Cron rows: request at :05 every six hours, ingest at :10.
DO $$
DECLARE
  anon text;
  base text := 'https://trhmcunttvpmylcxjkbd.supabase.co/functions/v1/';
  request_cmd text;
BEGIN
  SELECT substring(command FROM 'Bearer ([A-Za-z0-9_.-]+)') INTO anon
  FROM cron.job WHERE jobname = 'scrape-appstore-3x';
  IF anon IS NULL THEN
    RAISE EXCEPTION 'scrape-appstore-3x cron row missing; cannot derive anon bearer';
  END IF;

  request_cmd := format(
    $cmd$
      INSERT INTO public.vendor_status_snapshots (request_id, vendor)
      SELECT net.http_post(
               url := %L,
               headers := jsonb_build_object('Content-Type','application/json','Authorization',%L),
               body := jsonb_build_object('vendor', v)
             ), v
      FROM unnest(ARRAY['anthropic','openai','google','xai']) AS v;
    $cmd$,
    base || 'fetch-vendor-status',
    'Bearer ' || anon
  );

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vendor-status-request-6h') THEN
    PERFORM cron.schedule('vendor-status-request-6h', '5 */6 * * *', request_cmd);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vendor-status-ingest-6h') THEN
    PERFORM cron.schedule('vendor-status-ingest-6h', '10 */6 * * *', 'SELECT public.ingest_vendor_status_snapshots();');
  END IF;
END $$;
