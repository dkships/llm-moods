import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCRAPERS = [
  "scrape-reddit-apify",
  "scrape-hackernews",
  "scrape-bluesky",
  "scrape-twitter",
  "scrape-mastodon",
  "scrape-lemmy",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// EdgeRuntime is provided by Supabase Edge Runtime
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

async function logToErrorLog(supabase: any, functionName: string, msg: string, ctx?: string) {
  try {
    await supabase.from("error_log").insert({
      function_name: functionName,
      error_message: msg,
      context: ctx || null,
    });
  } catch (e) {
    console.error("logToErrorLog failed:", msg, e);
  }
}

async function runScraperAndRecord(supabase: any, name: string): Promise<void> {
  const started_at = new Date().toISOString();
  let posts_found = 0;
  let posts_classified = 0;
  let errors: string[] = [];
  let status = "success";

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "no body");
      errors = [`HTTP ${res.status}: ${text.slice(0, 500)}`];
      status = "failed";
    } else {
      let body: any = {};
      try {
        body = await res.json();
      } catch {
        // some scrapers may return non-JSON; treat as success with zeros
      }
      posts_found = body.posts_found ?? body.fetched ?? body.total ?? 0;
      posts_classified = body.posts_classified ?? body.classified ?? body.inserted ?? 0;
      errors = body.errors ?? [];
      status = errors.length > 0 ? "partial" : "success";
    }
  } catch (err) {
    errors = [String(err)];
    status = "failed";
  }

  const completed_at = new Date().toISOString();

  try {
    await supabase.from("scraper_runs").insert({
      source: name,
      started_at,
      completed_at,
      posts_found,
      posts_classified,
      errors,
      status,
    });
  } catch (e) {
    await logToErrorLog(
      supabase,
      "run-scrapers",
      `failed to insert scraper_runs row for ${name}: ${String(e)}`,
      "insert-error",
    );
  }
}

async function backgroundOrchestrate(dispatchedAt: string) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  await logToErrorLog(
    supabase,
    "run-scrapers",
    `Background orchestrator started (dispatched_at=${dispatchedAt}, scrapers=${SCRAPERS.length})`,
    "orchestrator-start",
  );

  // Run scrapers in batches of 3 to avoid overwhelming resources.
  // Each batch awaits its own scrapers so we can write scraper_runs rows
  // as soon as each finishes — but the orchestrator runs in the background,
  // so the HTTP response has already been returned.
  for (let i = 0; i < SCRAPERS.length; i += 3) {
    const batch = SCRAPERS.slice(i, i + 3);
    await Promise.all(batch.map((s) => runScraperAndRecord(supabase, s)));
  }

  // Trigger aggregate-vibes fire-and-forget — do not await its body
  let aggregateStatus = "dispatched";
  try {
    const aggRes = await fetch(`${SUPABASE_URL}/functions/v1/aggregate-vibes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!aggRes.ok) aggregateStatus = `failed HTTP ${aggRes.status}`;
  } catch (e) {
    aggregateStatus = `exception: ${String(e)}`;
  }

  await logToErrorLog(
    supabase,
    "run-scrapers",
    `Background orchestrator completed (aggregate=${aggregateStatus})`,
    "orchestrator-complete",
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const dispatchedAt = new Date().toISOString();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Synchronous startup log + scraper_runs marker row so we can see in the
  // monitor UI that the orchestrator was invoked.
  await logToErrorLog(
    supabase,
    "run-scrapers",
    `Dispatched ${SCRAPERS.length} scrapers in background: ${SCRAPERS.join(",")}`,
    "dispatch",
  );

  try {
    await supabase.from("scraper_runs").insert({
      source: "run-scrapers",
      started_at: dispatchedAt,
      completed_at: dispatchedAt,
      posts_found: 0,
      posts_classified: 0,
      errors: [],
      status: "success",
    });
  } catch (e) {
    console.error("failed to insert orchestrator marker row:", e);
  }

  // Fire-and-forget the heavy work
  const work = backgroundOrchestrate(dispatchedAt);
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work);
  } else {
    // Fallback: detach the promise so the response can return.
    // Errors are caught and logged inside backgroundOrchestrate.
    void work.catch((e) => console.error("background orchestrate error:", e));
  }

  const summary = {
    status: "dispatched",
    dispatched_at: dispatchedAt,
    scrapers_dispatched: SCRAPERS,
    note: "Scrapers run in background. Check scraper_runs and error_log for per-scraper results.",
  };

  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
