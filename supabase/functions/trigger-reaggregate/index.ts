// Temporary helper: forwards a service-role POST to reaggregate-vibes.
Deno.serve(async () => {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/reaggregate-vibes`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ days_back: 14 }),
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
});
