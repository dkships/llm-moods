import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyPost } from "../_shared/classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiKey = Deno.env.get("LOVABLE_API_KEY")!;

  const logError = async (msg: string, ctx?: string) => {
    try { await supabase.from("error_log").insert({ function_name: "reclassify-posts", error_message: msg, context: ctx || null }); } catch {}
  };

  try {
    const batchSize = 50;
    const { data: posts, error: fetchErr } = await supabase
      .from("scraped_posts")
      .select("id, title, content")
      .eq("sentiment", "neutral")
      .eq("confidence", 0.5)
      .gte("posted_at", "2026-03-10")
      .limit(batchSize);

    if (fetchErr) throw fetchErr;
    if (!posts || posts.length === 0) {
      return new Response(JSON.stringify({ message: "No posts to reclassify", remaining: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let classified = 0, irrelevant = 0, errors = 0;

    for (const post of posts) {
      const text = `${post.title || ""} ${post.content || ""}`.trim();
      if (!text) { errors++; continue; }

      const result = await classifyPost(text, apiKey, logError);

      if (!result.relevant) {
        await supabase.from("scraped_posts").delete().eq("id", post.id);
        irrelevant++;
      } else {
        await supabase.from("scraped_posts").update({
          sentiment: result.sentiment,
          complaint_category: result.complaint_category,
          praise_category: result.praise_category,
          confidence: result.confidence,
        }).eq("id", post.id);
        classified++;
      }

      await delay(100);
    }

    const { count } = await supabase
      .from("scraped_posts")
      .select("id", { count: "exact", head: true })
      .eq("sentiment", "neutral")
      .eq("confidence", 0.5)
      .gte("posted_at", "2026-03-10");

    return new Response(JSON.stringify({
      classified, irrelevant, errors,
      remaining: count || 0,
      message: (count || 0) > 0 ? "Call again to process more" : "All done!",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
