import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, isEnglish, meetsMinLength, loadRecentTitleKeys, isDuplicate, logToErrorLog } from "../_shared/utils.ts";

const TAGS = ["ai", "llm", "chatgpt", "openai"];

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;
    await logToErrorLog(supabase, "scrape-devto", "Dev.to scraper started (v2 - tiered matching)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "devto").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const cutoff = new Date(Date.now() - 48 * 3600000);
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, langSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };
    let reqIdx = 0;

    for (const tag of TAGS) {
      if (reqIdx > 0) await delay(1000);
      reqIdx++;

      try {
        const url = `https://dev.to/api/articles?tag=${tag}&per_page=30&state=fresh`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) { summary.errors.push(`tag=${tag}: HTTP ${res.status}`); continue; }

        const articles = await res.json();
        if (!Array.isArray(articles)) continue;
        summary.fetched += articles.length;

        // Pass 1: collect candidates
        const candidates: { fullText: string; matchedSlugs: string[]; sourceUrl: string; title: string; description: string; score: number; postedAt: string }[] = [];
        for (const article of articles) {
          const publishedAt = new Date(article.published_at || article.published_timestamp);
          if (publishedAt < cutoff) continue;

          const title = article.title || "";
          const description = article.description || "";
          const fullText = `${title} ${description}`;

          if (!isEnglish(fullText)) { summary.langSkipped++; continue; }
          if (!meetsMinLength(title, description)) { summary.contentSkipped++; continue; }

          const matchedSlugs = matchModels(fullText, keywords);
          if (matchedSlugs.length === 0) continue;
          summary.filtered++;

          const sourceUrl = article.url || "";
          if (!sourceUrl || existingUrls.has(sourceUrl)) continue;

          let allDuped = true;
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
          }
          if (allDuped) { summary.dedupSkipped++; continue; }

          candidates.push({ fullText, matchedSlugs, sourceUrl, title, description, score: article.positive_reactions_count || 0, postedAt: article.published_at || article.published_timestamp });
        }

        // Pass 2: batch classify
        const devtoLogError = async (msg: string, ctx?: string) => {
          await logToErrorLog(supabase, "scrape-devto", msg, ctx || "classify");
        };
        const classifications = await classifyBatch(candidates.map(c => c.fullText), lovableApiKey, 25, devtoLogError);
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
              model_id: modelId, source: "devto", source_url: c.sourceUrl,
              title: c.title.slice(0, 120), content: c.description.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              praise_category: classification.praise_category,
              confidence: classification.confidence, content_type: "title_and_body",
              score: c.score,
              posted_at: c.postedAt,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
              summary.inserted++;
              existingUrls.add(c.sourceUrl);
              titleKeys.add(`${modelId}:${c.title.slice(0, 80).toLowerCase()}`);
            }
          }
        }
      } catch (e) { summary.errors.push(`tag=${tag}: ${e instanceof Error ? e.message : String(e)}`); }
    }

    await logToErrorLog(supabase, "scrape-devto", `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted}`, "summary");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-devto", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
