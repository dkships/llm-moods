import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, meetsMinLength, loadRecentTitleKeys, isDuplicate, logToErrorLog } from "../_shared/utils.ts";

const BROAD_AI_KEYWORDS = ["llm", "large language model", "ai model", "copilot", "ai coding", "language model"];
const AI_TAGS = ["ai", "ml", "llm", "machine-learning"];

function hasAiContent(text: string): boolean {
  const lower = text.toLowerCase();
  return BROAD_AI_KEYWORDS.some(kw => lower.includes(kw));
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;
    await logToErrorLog(supabase, "scrape-lobsters", "Lobsters scraper started (v2 - tiered matching)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "lobsters").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const cutoff = new Date(Date.now() - 24 * 3600000);
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, langSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    const endpoints = ["https://lobste.rs/newest.json", "https://lobste.rs/hottest.json", "https://lobste.rs/t/ai.json", "https://lobste.rs/t/ml.json"];
    const seenIds = new Set<string>();

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, { headers: { Accept: "application/json" } });
        if (!res.ok) { summary.errors.push(`${endpoint}: HTTP ${res.status}`); continue; }

        const stories = await res.json();
        if (!Array.isArray(stories)) continue;
        summary.fetched += stories.length;

        // Pass 1: collect candidates
        const candidates: { text: string; matchedSlugs: string[]; sourceUrl: string; title: string; description: string; score: number; createdAt: string }[] = [];
        for (const story of stories) {
          if (seenIds.has(story.short_id)) continue;
          seenIds.add(story.short_id);

          const createdAt = new Date(story.created_at);
          if (createdAt < cutoff) continue;

          const text = `${story.title || ""} ${story.description || ""}`;
          if (!meetsMinLength(story.title || "", story.description || "")) { summary.contentSkipped++; continue; }

          const tags: string[] = story.tags || [];
          const hasAiTag = tags.some((t: string) => AI_TAGS.includes(t.toLowerCase()));
          const matchedSlugs = matchModels(text, keywords);

          if (matchedSlugs.length === 0) {
            if (!hasAiTag && !hasAiContent(text)) continue;
            const tagText = tags.join(" ");
            const tagMatches = matchModels(tagText, keywords);
            if (tagMatches.length > 0) matchedSlugs.push(...tagMatches);
            else continue;
          }
          summary.filtered++;

          const sourceUrl = story.comments_url || "";
          if (!sourceUrl || existingUrls.has(sourceUrl)) continue;

          let allDuped = true;
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (modelId && !isDuplicate(titleKeys, story.title || "", modelId)) { allDuped = false; break; }
          }
          if (allDuped) { summary.dedupSkipped++; continue; }

          candidates.push({ text, matchedSlugs, sourceUrl, title: story.title || "", description: story.description || "", score: story.score || 0, createdAt: story.created_at });
        }

        // Pass 2: batch classify
        const lobstersLogError = async (msg: string, ctx?: string) => {
          await logToErrorLog(supabase, "scrape-lobsters", msg, ctx || "classify");
        };
        const classifications = await classifyBatch(candidates.map(c => c.text), lovableApiKey, 25, lobstersLogError);
        summary.classified += classifications.length;
        summary.irrelevant += classifications.filter(c => !c.relevant).length;

        // Pass 2b: Re-classify each matched model with targeted sentiment.
        const targetedItems: { idx: number; slug: string }[] = [];
        for (let i = 0; i < candidates.length; i++) {
          if (!classifications[i].relevant) continue;
          for (const slug of candidates[i].matchedSlugs) {
            targetedItems.push({ idx: i, slug });
          }
        }
        const targetedResults = targetedItems.length > 0
          ? await classifyBatchTargeted(
              targetedItems.map(item => ({ text: candidates[item.idx].text, targetModel: item.slug })),
              lovableApiKey, 25, lobstersLogError
            )
          : [];
        const targetedMap = new Map<string, typeof classifications[0]>();
        targetedItems.forEach((item, j) => targetedMap.set(`${item.idx}:${item.slug}`, targetedResults[j]));

        // Pass 3: insert
        for (let i = 0; i < candidates.length; i++) {
          const baseClassification = classifications[i];
          if (!baseClassification.relevant) continue;
          const c = candidates[i];

          for (const slug of c.matchedSlugs) {
            const classification = targetedMap.get(`${i}:${slug}`) || classifications[i];
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, c.title, modelId)) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "lobsters", source_url: c.sourceUrl,
              title: c.title.slice(0, 500), content: c.description.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              praise_category: classification.praise_category,
              confidence: classification.confidence, content_type: c.description ? "title_and_body" : "title_only",
              original_language: classification.language || null,
              translated_content: classification.english_translation || null,
              score: c.score, posted_at: c.createdAt,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
              summary.inserted++;
              existingUrls.add(c.sourceUrl);
              titleKeys.add(`${modelId}:${c.title.slice(0, 80).toLowerCase()}`);
            }
          }
        }
      } catch (e) { summary.errors.push(`${endpoint}: ${e instanceof Error ? e.message : String(e)}`); }
    }

    await logToErrorLog(supabase, "scrape-lobsters", `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted}`, "summary");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-lobsters", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
