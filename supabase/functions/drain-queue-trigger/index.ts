// Cron-facing wrapper that invokes the gated `drain-classification-queue`
// edge function with the service-role key. pg_cron only has the anon key,
// so this trampoline keeps the downstream function gated to internal callers.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-drain-trigger-secret",
};

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const triggerSecret = Deno.env.get("DRAIN_QUEUE_TRIGGER_SECRET");
  if (triggerSecret && req.headers.get("x-drain-trigger-secret") !== triggerSecret) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "missing_env" }, 500);
  }

  let limit = 50;
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && "limit" in parsed) {
      const candidate = Number((parsed as { limit?: unknown }).limit);
      if (Number.isFinite(candidate)) limit = Math.max(1, Math.min(100, Math.trunc(candidate)));
    }
  } catch {
    // no body or invalid JSON, use defaults
  }

  try {
    const upstream = await fetch(`${supabaseUrl}/functions/v1/drain-classification-queue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ limit }),
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
