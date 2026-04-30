import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Temporary helper used to invoke gated maintenance functions
// (reclassify-posts, reaggregate-vibes) with the service-role key
// from scheduled pg_cron jobs. Delete after the quota-reset retry
// sweep completes.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch {}

  const action = body.action as string; // "reclassify" | "reaggregate"
  const label = (body.label as string) || action;

  let targetUrl = "";
  let targetBody: string | null = null;

  if (action === "reclassify") {
    const offset = Number(body.offset ?? 0);
    const batchSize = Number(body.batch_size ?? 25);
    const daysBack = Number(body.days_back ?? 2);
    targetUrl = `${SUPABASE_URL}/functions/v1/reclassify-posts?mode=recent_targeted&days_back=${daysBack}&batch_size=${batchSize}&offset=${offset}`;
  } else if (action === "reaggregate") {
    targetUrl = `${SUPABASE_URL}/functions/v1/reaggregate-vibes`;
    targetBody = JSON.stringify({
      days_back: Number(body.days_back ?? 30),
      min_posts: Number(body.min_posts ?? 5),
      dry_run: false,
      source: body.source || "lovable-quota-reset-retry",
    });
  } else {
    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = new Date().toISOString();
  let status = 0;
  let respText = "";
  let errMsg: string | null = null;

  try {
    const r = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: targetBody ?? "{}",
    });
    status = r.status;
    respText = await r.text();
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }

  await supabase.from("quota_retry_results").insert({
    label,
    action,
    status,
    response: respText,
    error: errMsg,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ label, status, ok: !errMsg }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});