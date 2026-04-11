import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, meetsMinLength, loadRecentTitleKeys, isDuplicate, logToErrorLog, triggerAggregateVibes } from "../_shared/utils.ts";

const INSTANCES = ["https://lemmy.world", "https://lemmy.ml"];
const SEARCH_TERMS = ["Claude", "ChatGPT", "GPT-5", "Gemini", "Grok", "LLM"];

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;
    await logToErrorLog(supabase, "scrape-lemmy", "Lemmy scraper started (v2 - tiered matching)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "lemmy").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const cutoff = new Date(Date.now() - 24 * 3600000);
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, langSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };
    let reqIdx = 0;

    for (const instance of INSTANCES) {
      for (const term of SEARCH_TERMS) {
        if (reqIdx > 0) await delay(2000);
        reqIdx++;

        try {
          const url = `${instance}/api/v3/search?q=${encodeURIComponent(term)}&type_=Posts&sort=New&limit=20`;
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) { summary.errors.push(`${instance} "${term}": HTTP ${res.status}`); continue; }

          const json = await res.json();
          const posts = json.posts || [];
          summary.fetched += posts.length;

          // Pass 1: collect candidates
          const candidates: { fullText: string; matchedSlugs: string[]; sourceUrl: string; title: string; body: string; score: number; published: string }[] = [];
          for (const item of posts) {
            const post = item.post || item.post_view?.post;
            const counts = item.counts || item.post_view?.counts;
            if (!post) continue;

            const publishedAt = new Date(post.published);
            if (publishedAt < cutoff) continue;

            const title = post.name || "";
            const body = post.body || "";
            const fullText = `${title} ${body}`;

            if (!meetsMinLength(title, body)) { summary.contentSkipped++; continue; }

            const matchedSlugs = matchModels(fullText, keywords);
            if (matchedSlugs.length === 0) continue;
            summary.filtered++;

            const sourceUrl = post.ap_id || "";
            if (!sourceUrl || existingUrls.has(sourceUrl)) continue;

            let allDuped = true;
            for (const slug of matchedSlugs) {
              const modelId = modelMap[slug];
              if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
            }
            if (allDuped) { summary.dedupSkipped++; continue; }

            candidates.push({ fullText, matchedSlugs, sourceUrl, title, body, score: counts?.score || 0, published: post.published });
          }

          // Pass 2: batch classify
          const lemmyLogError = async (msg: string, ctx?: string) => {
            await logToErrorLog(supabase, "scrape-lemmy", msg, ctx || "classify");
          };
          const classifications = await classifyBatch(candidates.map(c => c.fullText), lovableApiKey, 25, lemmyLogError);
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
                multiModelItems.map(m => ({ text: candidates[m.idx].fullText, targetModel: m.slug })),
                lovableApiKey, 25, lemmyLogError
              )
            : [];
          const targetedMap = new Map<string, typeof classifications[0]>();
          multiModelItems.forEach((m, j) => targetedMap.set(`${m.idx}:${m.slug}`, targetedResults[j]));

          // Pass 3: insert
          for (let i = 0; i < candidates.length; i++) {
            const classification = classifications[i];
            if (!classification.relevant) continue;
            const c = candidates[i];

            for (const slug of c.matchedSlugs) {
              const modelId = modelMap[slug];
              if (!modelId || isDuplicate(titleKeys, c.title, modelId)) continue;
              const cls = c.matchedSlugs.length > 1
                ? (targetedMap.get(`${i}:${slug}`) || classification)
                : classification;
              if (!cls.relevant) continue;
              const { error } = await supabase.from("scraped_posts").upsert({
                model_id: modelId, source: "lemmy", source_url: c.sourceUrl,
                title: c.title.slice(0, 120), content: (c.body || c.title).slice(0, 2000),
                sentiment: cls.sentiment, complaint_category: cls.complaint_category,
                praise_category: cls.praise_category,
                confidence: cls.confidence, content_type: c.body ? "title_and_body" : "title_only",
                original_language: cls.language || null,
                translated_content: cls.english_translation || null,
                score: c.score, posted_at: c.published,
              }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
              if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
                summary.inserted++;
                existingUrls.add(c.sourceUrl);
                titleKeys.add(`${modelId}:${c.title.slice(0, 80).toLowerCase()}`);
              }
            }
          }
        } catch (e) { summary.errors.push(`${instance} "${term}": ${e instanceof Error ? e.message : String(e)}`); }
      }
    }

    await logToErrorLog(supabase, "scrape-lemmy", `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted}`, "summary");
    await triggerAggregateVibes(supabase, "scrape-lemmy");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-lemmy", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
