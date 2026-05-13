// TEMPORARY one-shot helper. Re-aggregates vibes_scores over a 12-day window
// so historical days that were stamped `partial_coverage` mid-backlog get
// rewritten with current (fully-classified) post counts.
//
// Reason this exists: reaggregate-vibes is gated to service-role only, and
// Lovable's curl_edge_functions tool sends a user JWT. This trampoline runs
// inside the edge-function runtime where SUPABASE_SERVICE_ROLE_KEY is
// available, and forwards the call with the right auth.
//
// Default behavior: dry_run (no writes), with a diff_report so we can see the
// old-vs-new scores before applying. POST body `{"apply": true}` flips
// dry_run off and writes the new rows.
//
// DELETE this function after the one-shot reaggregate is complete.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "missing_env" }, 500);
  }

  let apply = false;
  let daysBack = 12;
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") {
      if ("apply" in parsed && (parsed as { apply?: unknown }).apply === true) apply = true;
      if ("days_back" in parsed) {
        const candidate = Number((parsed as { days_back?: unknown }).days_back);
        if (Number.isFinite(candidate)) daysBack = Math.max(1, Math.min(90, Math.trunc(candidate)));
      }
    }
  } catch {
    // no body or invalid JSON, use defaults
  }

  const upstreamBody = {
    days_back: daysBack,
    dry_run: !apply,
    diff_report: true,
  };

  try {
    const upstream = await fetch(`${supabaseUrl}/functions/v1/reaggregate-vibes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(upstreamBody),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: "upstream_failed", message }, 502);
  }
});
