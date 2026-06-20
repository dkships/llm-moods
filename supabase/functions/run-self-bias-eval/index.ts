// EPHEMERAL HELPER — delete from the deployed function list after use.
//
// `check-gemini-self-bias` is gated on isInternalServiceRequest (service-role
// Bearer), so Lovable's curl (which sends a user JWT) can't call it directly.
// This thin proxy reads SUPABASE_SERVICE_ROLE_KEY from the edge runtime and
// forwards the request body to check-gemini-self-bias with a service-role Bearer.
// It is intentionally ungated so Lovable can invoke it — which is exactly why it
// must be DELETED after the eval run (it can trigger paid Anthropic+Gemini calls).
//
// Usage (Lovable curl_edge_functions, POST body forwarded verbatim):
//   {"mode":"oracle","oracle":"gemini-2.5-flash",
//    "candidates":["claude-haiku-4-5-20251001"],"sample_size":120}
// Large samples exceed the ~60s curl timeout — the full report is written to
// error_log (function_name='check-gemini-self-bias', context='full-report').

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !supabaseUrl) {
    return new Response(JSON.stringify({ error: "missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.text().catch(() => "{}");
  const downstream = await fetch(`${supabaseUrl}/functions/v1/check-gemini-self-bias`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: body || "{}",
  });

  const text = await downstream.text();
  return new Response(text, {
    status: downstream.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
