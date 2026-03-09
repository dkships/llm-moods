import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const summary = { postsDeleted: 0, errorLogsDeleted: 0, errors: [] as string[] };

    // Delete scraped_posts older than 90 days
    const postsCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: oldPosts, error: postsErr } = await supabase
      .from("scraped_posts")
      .delete()
      .lt("posted_at", postsCutoff)
      .select("id");

    if (postsErr) {
      summary.errors.push(`Posts cleanup: ${postsErr.message}`);
    } else {
      summary.postsDeleted = oldPosts?.length || 0;
    }

    // Delete error_log entries older than 14 days
    const logsCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: oldLogs, error: logsErr } = await supabase
      .from("error_log")
      .delete()
      .lt("created_at", logsCutoff)
      .select("id");

    if (logsErr) {
      summary.errors.push(`Logs cleanup: ${logsErr.message}`);
    } else {
      summary.errorLogsDeleted = oldLogs?.length || 0;
    }

    await supabase.from("error_log").insert({
      function_name: "cleanup-old-posts",
      error_message: `Cleanup done: ${summary.postsDeleted} posts deleted, ${summary.errorLogsDeleted} logs deleted`,
      context: summary.errors.length > 0 ? summary.errors.join("; ") : null,
    });

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    try {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await supabase.from("error_log").insert({ function_name: "cleanup-old-posts", error_message: msg, context: "top-level error" });
    } catch {}
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
