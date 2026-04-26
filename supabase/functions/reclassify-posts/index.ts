import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import { isInternalServiceRequest, internalOnlyResponse } from "../_shared/runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // reclassify-posts hits the paid Gemini API on every call. The repo is
  // public, so the anon key is too — without this gate, anyone can drain
  // our quota. Invoke only via service-role headers (Lovable SQL prompt or
  // an internal edge fn), never from the browser.
  if (!isInternalServiceRequest(req)) return internalOnlyResponse(corsHeaders);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiKey = Deno.env.get("GEMINI_API_KEY")!;

  const logError = async (msg: string, ctx?: string) => {
    try { await supabase.from("error_log").insert({ function_name: "reclassify-posts", error_message: msg, context: ctx || null }); } catch {}
  };

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "neutral";
    const batchSize = Math.max(1, Math.min(parseInt(url.searchParams.get("batch_size") || "100", 10) || 100, 500));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
    const postedAfter = url.searchParams.get("posted_after");
    const postedBefore = url.searchParams.get("posted_before");

    if (mode === "multi_model") {
      return await handleMultiModel(supabase, apiKey, batchSize, logError);
    }

    if (mode === "recent_targeted") {
      const daysBack = Math.max(1, Math.min(parseInt(url.searchParams.get("days_back") || "7", 10) || 7, 30));
      return await handleRecentTargeted(
        supabase,
        apiKey,
        batchSize,
        daysBack,
        offset,
        postedAfter,
        postedBefore,
        logError,
      );
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

  return await reclassifyTargetedPosts(supabase, apiKey, dupes, "multi_model", null, logError);
}

async function handleRecentTargeted(
  supabase: any,
  apiKey: string,
  batchSize: number,
  daysBack: number,
  offset: number,
  postedAfter: string | null,
  postedBefore: string | null,
  logError: (msg: string, ctx?: string) => Promise<void>,
): Promise<Response> {
  const effectiveAfter = postedAfter || new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const effectiveBefore = postedBefore || null;

  let postsQuery = supabase
    .from("scraped_posts")
    .select("id, model_id, title, content, posted_at")
    .gte("posted_at", effectiveAfter)
    .order("posted_at", { ascending: false })
    .range(offset, offset + batchSize - 1);

  let countQuery = supabase
    .from("scraped_posts")
    .select("id", { count: "exact", head: true })
    .gte("posted_at", effectiveAfter);

  if (effectiveBefore) {
    postsQuery = postsQuery.lt("posted_at", effectiveBefore);
    countQuery = countQuery.lt("posted_at", effectiveBefore);
  }

  const [{ data: posts, error: postsError }, { data: models, error: modelsError }, { count, error: countError }] = await Promise.all([
    postsQuery,
    supabase.from("models").select("id, slug"),
    countQuery,
  ]);

  if (postsError) throw postsError;
  if (modelsError) throw modelsError;
  if (countError) throw countError;

  const slugById: Record<string, string> = {};
  for (const model of models || []) slugById[model.id] = model.slug;

  const items = (posts || [])
    .map((post: any) => ({
      id: post.id,
      text: `${post.title || ""} ${post.content || ""}`.trim(),
      model_slug: slugById[post.model_id] || "unknown",
    }))
    .filter((item: { id: string; text: string; model_slug: string }) => item.text.length > 0 && item.model_slug !== "unknown");

  if (items.length === 0) {
    return new Response(JSON.stringify({
      mode: "recent_targeted",
      message: "No posts found to reclassify in this window",
      posted_after: effectiveAfter,
      posted_before: effectiveBefore,
      offset,
      batch_size: batchSize,
      total_matching: count || 0,
      total: 0,
    }), { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } });
  }

  return await reclassifyTargetedPosts(
    supabase,
    apiKey,
    items,
    "recent_targeted",
    {
      posted_after: effectiveAfter,
      posted_before: effectiveBefore,
      offset,
      batch_size: batchSize,
      total_matching: count || items.length,
      remaining_after_batch: Math.max((count || items.length) - offset - items.length, 0),
    },
    logError,
  );
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

  return await reclassifyTargetedPosts(supabase, apiKey, toProcess.map((p: any) => ({
    id: p.id,
    text: `${p.title || ""} ${p.content || ""}`.trim(),
    model_slug: slugById[p.model_id] || "unknown",
  })), "multi_model", null, logError);
}

async function reclassifyTargetedPosts(
  supabase: any,
  apiKey: string,
  items: { id: string; text: string; model_slug: string }[],
  mode: "multi_model" | "recent_targeted",
  meta: Record<string, unknown> | null,
  logError: (msg: string, ctx?: string) => Promise<void>,
): Promise<Response> {
  const targetedItems = items.map(item => ({ text: item.text, targetModel: item.model_slug }));
  const classifications = await classifyBatchTargeted(targetedItems, apiKey, 25, logError);

  let reclassified = 0, clearedIrrelevant = 0, errors = 0;

  for (let i = 0; i < items.length; i++) {
    const result = classifications[i];
    const item = items[i];

    const payload = result.relevant
      ? {
          sentiment: result.sentiment,
          complaint_category: result.complaint_category,
          praise_category: result.praise_category,
          confidence: result.confidence,
          original_language: result.language || null,
          translated_content: result.english_translation || null,
        }
      : {
          sentiment: null,
          complaint_category: null,
          praise_category: null,
          confidence: 0,
          original_language: null,
          translated_content: null,
        };

    const { error } = await supabase.from("scraped_posts").update(payload).eq("id", item.id);

    if (error) {
      errors++;
      continue;
    }

    if (result.relevant) {
      reclassified++;
    } else {
      clearedIrrelevant++;
    }
  }

  return new Response(JSON.stringify({
    mode,
    total: items.length,
    reclassified,
    cleared_irrelevant: clearedIrrelevant,
    errors,
    ...(meta || {}),
    message: (reclassified > 0 || clearedIrrelevant > 0)
      ? `Updated ${reclassified} posts with model-targeted sentiment and cleared ${clearedIrrelevant} irrelevant rows`
      : "No changes needed",
  }), { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } });
}
