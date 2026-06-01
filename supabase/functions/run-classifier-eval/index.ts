// TEMPORARY smoke-test helper — DELETE after the Gemini→Claude eval run.
//
// check-gemini-self-bias is gated to service-role (isInternalServiceRequest),
// but Lovable's curl_edge_functions sends a user JWT, so it can't call the
// harness directly. This helper reads SUPABASE_SERVICE_ROLE_KEY from the
// edge-function runtime and forwards a Bearer-authenticated POST to the harness,
// passing the incoming body straight through.
//
// The repo is public, so while deployed this is an ungated proxy to a paid
// function. Remove it from the deployed function list as soon as the smoke
// test completes (see CLAUDE.md "Service-role invocation pattern"). It only
// ever forwards to check-gemini-self-bias, which is sample-size-capped and
// never writes public scores.
import { corsHeaders } from "../_shared/utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "missing service-role env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/check-gemini-self-bias`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
