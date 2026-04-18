import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, meetsMinLength, loadRecentTitleKeys, isDuplicate, logToErrorLog, triggerAggregateVibes } from "../_shared/utils.ts";

const SUBREDDIT_MODEL_MAP: Record<string, string> = {
  "r/ClaudeAI": "claude",
  "r/claudeai": "claude",
  "r/ChatGPT": "chatgpt",
  "r/chatgpt": "chatgpt",
  "r/GoogleGemini": "gemini",
  "r/googlegemini": "gemini",
};

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const apifyToken = Deno.env.get("APIFY_API_TOKEN");
    if (!apifyToken) {
      await logToErrorLog(supabase, "scrape-reddit-apify", "APIFY_API_TOKEN not configured", "config-error");
      return new Response(JSON.stringify({ error: "APIFY_API_TOKEN not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;
    await logToErrorLog(supabase, "scrape-reddit-apify", "Reddit Apify scraper started (v3 - reduced subreddits)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);

    const startUrl = `https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/runs?token=${apifyToken}`;
    const apifyInput = {
      startUrls: [
        { url: "https://www.reddit.com/r/ClaudeAI/" },
        { url: "https://www.reddit.com/r/ChatGPT/" },
        { url: "https://www.reddit.com/r/LocalLLaMA/" },
        { url: "https://www.reddit.com/r/GoogleGemini/" },
        { url: "https://www.reddit.com/r/artificial/" },
      ],
      maxItems: 40,
      skipComments: true,
      searchPosts: true,
      sort: "new",
    };

    const startRes = await fetch(startUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(apifyInput) });
    if (!startRes.ok) {
      const errorText = await startRes.text().catch(() => "unknown");
      await logToErrorLog(supabase, "scrape-reddit-apify", `Apify start failed HTTP ${startRes.status}: ${errorText.slice(0, 500)}`, "apify-error");
      if (startRes.status === 402 || startRes.status === 403) {
        return new Response(JSON.stringify({ error: `Apify quota/auth error (HTTP ${startRes.status})`, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: `Apify start returned ${startRes.status}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const runData = await startRes.json();
    const runId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;
    if (!runId || !datasetId) {
      await logToErrorLog(supabase, "scrape-reddit-apify", `No runId/datasetId`, "apify-error");
      return new Response(JSON.stringify({ error: "Missing runId from Apify" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const maxPolls = 24;
    let runStatus = "";
    for (let i = 0; i < maxPolls; i++) {
      await delay(10000);
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`);
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();
      runStatus = statusData.data?.status || "";
      if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(runStatus)) break;
    }

    if (runStatus !== "SUCCEEDED") {
      let errorDetail = "";
      try {
        const detailRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`);
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          errorDetail = detailData.data?.statusMessage || detailData.data?.exitCode || "";
        }
      } catch {}
      await logToErrorLog(supabase, "scrape-reddit-apify", `Apify run status: ${runStatus || "TIMEOUT"} detail: ${errorDetail}`, "apify-error");
      return new Response(JSON.stringify({ error: `Apify run status: ${runStatus || "TIMEOUT"}`, detail: errorDetail }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&format=json`);
    if (!datasetRes.ok) return new Response(JSON.stringify({ error: "Failed to fetch dataset" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const items = await datasetRes.json();
    if (!Array.isArray(items)) return new Response(JSON.stringify({ error: "Invalid dataset response" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const posts = items.filter((item: any) => item.dataType === "post");
    const { data: existingData } = await supabase.from("scraped_posts").select("source_url").eq("source", "reddit").limit(10000);
    const existingUrls = new Set((existingData || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const cutoff = new Date(Date.now() - 24 * 3600000);
    const summary = { apifyItems: items.length, apifyPosts: posts.length, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, langSkipped: 0, duplicateSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    // Pass 1: collect candidates
    const candidates: { fullText: string; matchedSlugs: string[]; sourceUrl: string; title: string; body: string; score: number; createdAt: string }[] = [];
    for (const post of posts) {
      const createdAt = new Date(post.createdAt);
      if (createdAt < cutoff) continue;

      const title = post.title || "";
      const body = post.body || "";
      const fullText = `${title} ${body}`;

      if (!meetsMinLength(title, body)) { summary.contentSkipped++; continue; }

      const matchedSlugs = matchModels(fullText, keywords, SUBREDDIT_MODEL_MAP, post.communityName);
      if (matchedSlugs.length === 0) continue;
      summary.filtered++;

      const sourceUrl = post.url || "";
      if (!sourceUrl || existingUrls.has(sourceUrl)) { summary.duplicateSkipped++; continue; }

      let allDuped = true;
      for (const slug of matchedSlugs) {
        const modelId = modelMap[slug];
        if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
      }
      if (allDuped) { summary.dedupSkipped++; continue; }

      candidates.push({ fullText, matchedSlugs, sourceUrl, title, body, score: post.upVotes || 0, createdAt: post.createdAt });
    }

    // Pass 2: batch classify
    const redditLogError = async (msg: string, ctx?: string) => {
      await logToErrorLog(supabase, "scrape-reddit-apify", msg, ctx || "classify");
    };
    const classifications = await classifyBatch(candidates.map(c => c.fullText), geminiApiKey, 25, redditLogError);
    summary.classified = classifications.length;
    summary.irrelevant = classifications.filter(c => !c.relevant).length;

    // Pass 2.5: targeted classification for each matched model.
    const targetedItems: { idx: number; slug: string }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (!classifications[i].relevant) continue;
      for (const slug of candidates[i].matchedSlugs) {
        targetedItems.push({ idx: i, slug });
      }
    }
    const targetedResults = targetedItems.length > 0
      ? await classifyBatchTargeted(
          targetedItems.map(item => ({ text: candidates[item.idx].fullText, targetModel: item.slug })),
          geminiApiKey, 25, redditLogError
        )
      : [];
    const targetedMap = new Map<string, typeof classifications[0]>();
    targetedItems.forEach((item, j) => targetedMap.set(`${item.idx}:${item.slug}`, targetedResults[j]));

    // Pass 3: insert
    for (let i = 0; i < candidates.length; i++) {
      const classification = classifications[i];
      if (!classification.relevant) continue;
      const c = candidates[i];

      for (const slug of c.matchedSlugs) {
        const cls = targetedMap.get(`${i}:${slug}`) || classification;
        if (!cls.relevant) continue;
        const modelId = modelMap[slug];
        if (!modelId || isDuplicate(titleKeys, c.title, modelId)) continue;
        const { error } = await supabase.from("scraped_posts").upsert({
          model_id: modelId, source: "reddit", source_url: c.sourceUrl,
          title: c.title.slice(0, 120), content: (c.body || c.title).slice(0, 2000),
          sentiment: cls.sentiment, complaint_category: cls.complaint_category,
          praise_category: cls.praise_category,
          confidence: cls.confidence, content_type: c.body ? "title_and_body" : "title_only",
          score: c.score, posted_at: c.createdAt,
          original_language: cls.language || null, translated_content: cls.english_translation || null,
        }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
        if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
          summary.inserted++;
          existingUrls.add(c.sourceUrl);
          titleKeys.add(`${modelId}:${c.title.slice(0, 80).toLowerCase()}`);
        }
      }
    }

    await logToErrorLog(supabase, "scrape-reddit-apify", `Completed: posts=${summary.apifyPosts} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted} dedupSkipped=${summary.dedupSkipped}`, "summary");
    await triggerAggregateVibes(supabase, "scrape-reddit-apify");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-reddit-apify", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
