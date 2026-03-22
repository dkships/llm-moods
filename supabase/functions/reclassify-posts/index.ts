import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiKey = Deno.env.get("GEMINI_API_KEY")!;

  const logError = async (msg: string, ctx?: string) => {
    try { await supabase.from("error_log").insert({ function_name: "reclassify-posts", error_message: msg, context: ctx || null }); } catch {}
  };

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "neutral";
    const batchSize = 50;

    if (mode === "multi_model") {
      return await handleMultiModel(supabase, apiKey, batchSize, logError);
    }

    // Default mode: reclassify low-confidence neutral posts
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

    const candidates: { id: string; text: string }[] = [];
    for (const post of posts) {
      const text = `${post.title || ""} ${post.content || ""}`.trim();
      if (!text) { errors++; continue; }
      candidates.push({ id: post.id, text });
    }

    const classifications = await classifyBatch(candidates.map(c => c.text), apiKey, undefined, logError);

    for (let i = 0; i < candidates.length; i++) {
      const result = classifications[i];
      const c = candidates[i];

      if (!result.relevant) {
        irrelevant++;
        continue;
      } else {
        await supabase.from("scraped_posts").update({
          sentiment: result.sentiment,
          complaint_category: result.complaint_category,
          praise_category: result.praise_category,
          confidence: result.confidence,
          original_language: result.language || null,
          translated_content: result.english_translation || null,
        }).eq("id", c.id);
        classified++;
      }
    }

    const { count } = await supabase
      .from("scraped_posts")
      .select("id", { count: "exact", head: true })
      .eq("sentiment", "neutral")
      .eq("confidence", 0.5)
      .gte("posted_at", "2026-03-10");

    return new Response(JSON.stringify({
      mode: "neutral",
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

async function handleMultiModel(
  supabase: any,
  apiKey: string,
  batchSize: number,
  logError: (msg: string, ctx?: string) => Promise<void>,
): Promise<Response> {
  // Find posts where the same source_url has multiple model_ids with identical sentiment.
  // These are multi-model posts that were classified with generic (non-targeted) sentiment.
  const { data: dupes, error: dupeErr } = await supabase.rpc("find_multi_model_misclassified", { batch_limit: batchSize });

  if (dupeErr) {
    // RPC doesn't exist yet — fall back to a manual query approach
    await logError(`RPC not found, using fallback query: ${dupeErr.message}`, "multi-model-fallback");
    return await handleMultiModelFallback(supabase, apiKey, batchSize, logError);
  }

  if (!dupes || dupes.length === 0) {
    return new Response(JSON.stringify({ mode: "multi_model", message: "No multi-model misclassifications found", reclassified: 0 }), {
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    });
  }

  return await reclassifyMultiModelPosts(supabase, apiKey, dupes, logError);
}

async function handleMultiModelFallback(
  supabase: any,
  apiKey: string,
  batchSize: number,
  logError: (msg: string, ctx?: string) => Promise<void>,
): Promise<Response> {
  // Get posts that share a source_url with other posts but have different model_ids and same sentiment
  // We find source_urls that appear with 2+ different model_ids
  const { data: posts, error } = await supabase
    .from("scraped_posts")
    .select("id, source_url, model_id, title, content, sentiment")
    .not("source_url", "is", null)
    .order("source_url")
    .limit(5000);

  if (error) throw error;
  if (!posts || posts.length === 0) {
    return new Response(JSON.stringify({ mode: "multi_model", message: "No posts found", reclassified: 0 }), {
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    });
  }

  // Group by source_url
  const groups = new Map<string, any[]>();
  for (const post of posts) {
    if (!post.source_url) continue;
    const group = groups.get(post.source_url) || [];
    group.push(post);
    groups.set(post.source_url, group);
  }

  // Find groups with 2+ model_ids where all sentiments are the same
  const misclassified: any[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const modelIds = new Set(group.map((p: any) => p.model_id));
    if (modelIds.size < 2) continue; // same model_id, different posts — not what we want
    const sentiments = new Set(group.map((p: any) => p.sentiment));
    if (sentiments.size === 1) {
      // All have same sentiment — likely misclassified
      misclassified.push(...group);
    }
  }

  if (misclassified.length === 0) {
    return new Response(JSON.stringify({ mode: "multi_model", message: "No multi-model misclassifications found", reclassified: 0 }), {
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    });
  }

  // Limit to batchSize
  const toProcess = misclassified.slice(0, batchSize);

  // Load model slugs
  const { data: models } = await supabase.from("models").select("id, slug");
  const slugById: Record<string, string> = {};
  for (const m of models || []) slugById[m.id] = m.slug;

  return await reclassifyMultiModelPosts(supabase, apiKey, toProcess.map((p: any) => ({
    id: p.id,
    text: `${p.title || ""} ${p.content || ""}`.trim(),
    model_slug: slugById[p.model_id] || "unknown",
  })), logError);
}

async function reclassifyMultiModelPosts(
  supabase: any,
  apiKey: string,
  items: { id: string; text: string; model_slug: string }[],
  logError: (msg: string, ctx?: string) => Promise<void>,
): Promise<Response> {
  const targetedItems = items.map(item => ({ text: item.text, targetModel: item.model_slug }));
  const classifications = await classifyBatchTargeted(targetedItems, apiKey, 25, logError);

  let reclassified = 0, irrelevant = 0, errors = 0;

  for (let i = 0; i < items.length; i++) {
    const result = classifications[i];
    const item = items[i];

    if (!result.relevant) {
      irrelevant++;
      continue;
    }

    const { error } = await supabase.from("scraped_posts").update({
      sentiment: result.sentiment,
      complaint_category: result.complaint_category,
      praise_category: result.praise_category,
      confidence: result.confidence,
      original_language: result.language || null,
      translated_content: result.english_translation || null,
    }).eq("id", item.id);

    if (error) { errors++; } else { reclassified++; }
  }

  return new Response(JSON.stringify({
    mode: "multi_model",
    total: items.length,
    reclassified,
    irrelevant,
    errors,
    message: reclassified > 0 ? `Reclassified ${reclassified} posts with model-targeted sentiment` : "No changes needed",
  }), { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } });
}
