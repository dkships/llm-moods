import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, meetsMinLength, loadRecentTitleKeys, isDuplicate, logToErrorLog } from "../_shared/utils.ts";

const SEARCH_TERMS = [
  "Claude AI", "ChatGPT", "GPT-5", "Gemini AI", "Grok AI",
  "Claude dumb", "ChatGPT worse",
];

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); }
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }


async function authenticateBluesky(handle: string, appPassword: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.accessJwt || null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;
    const blueskyHandle = Deno.env.get("BLUESKY_HANDLE");
    const blueskyAppPassword = Deno.env.get("BLUESKY_APP_PASSWORD");

    if (!blueskyHandle || !blueskyAppPassword) {
      await logToErrorLog(supabase, "scrape-bluesky", "Missing BLUESKY credentials", "auth");
      return new Response(JSON.stringify({ error: "Missing Bluesky credentials" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessJwt = await authenticateBluesky(blueskyHandle, blueskyAppPassword);
    if (!accessJwt) {
      await logToErrorLog(supabase, "scrape-bluesky", "Bluesky auth failed", "auth");
      return new Response(JSON.stringify({ error: "Bluesky authentication failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await logToErrorLog(supabase, "scrape-bluesky", "Bluesky scraper started (v2 - tiered matching)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "bluesky").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const cutoff = new Date(Date.now() - 24 * 3600000);
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, langSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    for (let i = 0; i < SEARCH_TERMS.length; i++) {
      const term = SEARCH_TERMS[i];
      if (i > 0) await delay(1000);

      try {
        const url = `https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&limit=25&sort=latest`;
        const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${accessJwt}`, Accept: "application/json" } });
        if (!res.ok) { const t = await res.text(); summary.errors.push(`"${term}": HTTP ${res.status} - ${t.slice(0, 100)}`); continue; }

        const json = await res.json();
        const posts = json.posts || [];
        summary.fetched += posts.length;

        // Pass 1: collect candidates
        const candidates: { text: string; matchedSlugs: string[]; sourceUrl: string; createdAt: string; score: number }[] = [];
        for (const post of posts) {
          const text = post.record?.text || "";
          const createdAt = post.record?.createdAt ? new Date(post.record.createdAt) : null;
          if (!createdAt || createdAt < cutoff) continue;

          if (!meetsMinLength(text, "")) { summary.contentSkipped++; continue; }

          const matchedSlugs = matchModels(text, keywords);
          if (matchedSlugs.length === 0) continue;
          summary.filtered++;

          const handle = post.author?.handle || "";
          const uriParts = (post.uri || "").split("/");
          const rkey = uriParts[uriParts.length - 1];
          const sourceUrl = `https://bsky.app/profile/${handle}/post/${rkey}`;
          if (existingUrls.has(sourceUrl)) continue;

          let allDuped = true;
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (modelId && !isDuplicate(titleKeys, text.slice(0, 120), modelId)) { allDuped = false; break; }
          }
          if (allDuped) { summary.dedupSkipped++; continue; }

          candidates.push({ text, matchedSlugs, sourceUrl, createdAt: createdAt.toISOString(), score: post.likeCount || 0 });
        }

        // Pass 2: batch classify
        const bskyLogError = async (msg: string, ctx?: string) => {
          await logToErrorLog(supabase, "scrape-bluesky", msg, ctx || "classify");
        };
        const classifications = await classifyBatch(candidates.map(c => c.text), lovableApiKey, 25, bskyLogError);
        summary.classified += classifications.length;
        summary.irrelevant += classifications.filter(c => !c.relevant).length;

        // Pass 2b: Re-classify multi-model posts with targeted sentiment
        const multiModelItems: { idx: number; slug: string }[] = [];
        for (let i = 0; i < candidates.length; i++) {
          if (candidates[i].matchedSlugs.length > 1 && classifications[i].relevant) {
            for (const slug of candidates[i].matchedSlugs) {
              multiModelItems.push({ idx: i, slug });
            }
          }
        }
        const targetedResults = multiModelItems.length > 0
          ? await classifyBatchTargeted(
              multiModelItems.map(m => ({ text: candidates[m.idx].text, targetModel: m.slug })),
              lovableApiKey, 25, bskyLogError
            )
          : [];
        const targetedMap = new Map<string, typeof classifications[0]>();
        multiModelItems.forEach((m, j) => targetedMap.set(`${m.idx}:${m.slug}`, targetedResults[j]));

        // Pass 3: insert
        for (let i = 0; i < candidates.length; i++) {
          const baseClassification = classifications[i];
          if (!baseClassification.relevant) continue;
          const c = candidates[i];

          for (const slug of c.matchedSlugs) {
            const classification = c.matchedSlugs.length > 1
              ? (targetedMap.get(`${i}:${slug}`) || classifications[i])
              : classifications[i];
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, c.text.slice(0, 120), modelId)) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "bluesky", source_url: c.sourceUrl,
              title: c.text.slice(0, 120), content: c.text.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              praise_category: classification.praise_category,
              confidence: classification.confidence, content_type: "full_content",
              original_language: classification.language || null,
              translated_content: classification.english_translation || null,
              score: c.score, posted_at: c.createdAt,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
              summary.inserted++;
              existingUrls.add(c.sourceUrl);
              titleKeys.add(`${modelId}:${c.text.slice(0, 80).toLowerCase()}`);
            }
          }
        }
      } catch (e) { summary.errors.push(`"${term}": ${e instanceof Error ? e.message : String(e)}`); }
    }

    await logToErrorLog(supabase, "scrape-bluesky", `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted}`, "summary");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-bluesky", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
