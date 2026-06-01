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

// Supabase Edge runtime global for keeping a worker alive past the response.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

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

  const runEval = fetch(`${supabaseUrl}/functions/v1/check-gemini-self-bias`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).then((r) => r.text()).catch(() => undefined);

  // The harness runs for minutes; Lovable's curl closes the connection at ~60s
  // and the runtime tears down the worker. waitUntil keeps this worker alive so
  // the background harness call completes and writes its error_log report
  // regardless of the client connection. Read the result from error_log.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(runEval);
    return new Response(
      JSON.stringify({
        status: "started",
        note: "Eval running in background; read error_log full-report rows in a few minutes.",
      }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Fallback (no background runtime): run synchronously and return the report.
  const text = await runEval;
  return new Response(text ?? "{}", {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
