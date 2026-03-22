import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, isEnglish, meetsMinLength, loadRecentTitleKeys, isDuplicate, logToErrorLog } from "../_shared/utils.ts";

const SEARCH_TERMS = ["ChatGPT", "Claude AI", "Gemini AI", "GPT-5"];

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;

    await logToErrorLog(supabase, "scrape-stackoverflow", "Function started (v2)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "stackoverflow").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 3600000) / 1000);
    const summary = { fetched: 0, inserted: 0, classified: 0, irrelevant: 0, skipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    for (const term of SEARCH_TERMS) {
      try {
        const url = `https://api.stackexchange.com/2.3/search?order=desc&sort=activity&intitle=${encodeURIComponent(term)}&site=stackoverflow&pagesize=25&filter=withbody`;
        const res = await fetch(url);
        if (!res.ok) { summary.errors.push(`${term}: ${res.status}`); await delay(2000); continue; }

        const data = await res.json();
        const items = data.items || [];
        summary.fetched += items.length;

        // Pass 1: collect candidates
        const candidates: { classifyText: string; matchedSlugs: string[]; sourceUrl: string; title: string; body: string; score: number; postedAt: string }[] = [];
        for (const item of items) {
          if ((item.last_activity_date || item.creation_date) < sevenDaysAgo) continue;

          const title = item.title || "";
          const body = (item.body || "").replace(/<[^>]*>/g, "").slice(0, 2000);
          if (!isEnglish(title)) continue;
          if (!meetsMinLength(title, body)) { summary.contentSkipped++; continue; }

          const sourceUrl = item.link;
          if (!sourceUrl || existingUrls.has(sourceUrl)) { summary.skipped++; continue; }

          const matchedSlugs = matchModels(title + " " + body, keywords);
          if (matchedSlugs.length === 0) continue;

          let allDuped = true;
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
          }
          if (allDuped) { summary.dedupSkipped++; continue; }

          candidates.push({ classifyText: `${title} ${body}`, matchedSlugs, sourceUrl, title, body, score: item.score || 0, postedAt: new Date(item.creation_date * 1000).toISOString() });
        }

        // Pass 2: batch classify
        const soLogError = async (msg: string, ctx?: string) => {
          await logToErrorLog(supabase, "scrape-stackoverflow", msg, ctx || "classify");
        };
        const classifications = await classifyBatch(candidates.map(c => c.classifyText), lovableApiKey, 25, soLogError);
        summary.classified += classifications.length;
        summary.irrelevant += classifications.filter(c => !c.relevant).length;

        // Pass 3: insert
        for (let i = 0; i < candidates.length; i++) {
          const classification = classifications[i];
          if (!classification.relevant) continue;
          const c = candidates[i];

          for (const slug of c.matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, c.title, modelId)) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "stackoverflow", source_url: c.sourceUrl,
              title: c.title.slice(0, 500), content: c.body.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              praise_category: classification.praise_category,
              confidence: classification.confidence, content_type: "title_and_body",
              score: c.score,
              posted_at: c.postedAt,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(error.message); } else {
              summary.inserted++;
              existingUrls.add(c.sourceUrl);
              titleKeys.add(`${modelId}:${c.title.slice(0, 80).toLowerCase()}`);
            }
          }
        }
      } catch (e) { summary.errors.push(`${term}: ${e instanceof Error ? e.message : "unknown"}`); }
      await delay(2000);
    }

    await logToErrorLog(supabase, "scrape-stackoverflow", `Done: inserted=${summary.inserted} fetched=${summary.fetched} classified=${summary.classified} irrelevant=${summary.irrelevant}`, `skipped=${summary.skipped} errors=${summary.errors.length}`);

    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-stackoverflow", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
