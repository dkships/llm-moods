const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (_req) => {
  const haveKey = SERVICE_ROLE_KEY ? `len=${SERVICE_ROLE_KEY.length}` : "MISSING";
  const r = await fetch(`${SUPABASE_URL}/functions/v1/run-pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ dry_run: true, force: true }),
  });
  const text = await r.text();
  return new Response(JSON.stringify({ debug: { haveKey, status: r.status }, body: text }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});