import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: { env: { get(n: string): string | undefined }; serve: (h: (r: Request) => Response | Promise<Response>) => void };

Deno.serve(async (req) => {
  const body = await req.text();
  const u = new URL(req.url);
  const target = u.searchParams.get("target") ?? "historical-gap-fill";
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${target}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body,
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
});