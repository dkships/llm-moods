import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, isEnglish, meetsMinLength, loadRecentTitleKeys, isDuplicate, logToErrorLog } from "../_shared/utils.ts";

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1/search_by_date";
const STORY_SEARCH_TERMS = ["Claude", "ChatGPT", "GPT-5", "Gemini", "Grok", "OpenAI", "Anthropic"];
const COMMENT_SEARCH_TERMS = ["Claude dumb", "ChatGPT worse", "GPT bad", "Gemini sucks", "Grok useless"];

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;

    await logToErrorLog(supabase, "scrape-hackernews", "HN scraper started (v2 - tiered matching)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "hackernews").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const oneDayAgo = Math.floor((Date.now() - 24 * 3600000) / 1000);
    const summary = { stories: 0, comments: 0, classified: 0, inserted: 0, irrelevant: 0, skipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    for (const term of STORY_SEARCH_TERMS) {
      try {
        const url = `${ALGOLIA_BASE}?query=${encodeURIComponent(term)}&tags=story&numericFilters=created_at_i>${oneDayAgo}&hitsPerPage=50`;
        const res = await fetch(url);
        if (!res.ok) { summary.errors.push(`Story ${term}: ${res.status}`); await delay(1000); continue; }
        const data = await res.json();
        const hits = data.hits || [];
        summary.stories += hits.length;

        // Pass 1: collect story candidates
        const storyCandidates: { text: string; matchedSlugs: string[]; sourceUrl: string; title: string; score: number; postedAt: string }[] = [];
        for (const hit of hits) {
          if (!hit.title || !isEnglish(hit.title)) continue;
          if (!meetsMinLength(hit.title, "")) { summary.contentSkipped++; continue; }
          const sourceUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
          if (existingUrls.has(sourceUrl)) { summary.skipped++; continue; }

          const matchedSlugs = matchModels(hit.title + " " + (hit.url || ""), keywords);
          if (matchedSlugs.length === 0) continue;

          let allDuped = true;
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (modelId && !isDuplicate(titleKeys, hit.title, modelId)) { allDuped = false; break; }
          }
          if (allDuped) { summary.dedupSkipped++; continue; }

          storyCandidates.push({ text: hit.title, matchedSlugs, sourceUrl, title: hit.title, score: hit.points || 0, postedAt: hit.created_at || new Date().toISOString() });
        }

        // Pass 2: batch classify stories
        const hnLogError = async (msg: string, ctx?: string) => {
          await logToErrorLog(supabase, "scrape-hackernews", msg, ctx || "classify");
        };
        const storyClassifications = await classifyBatch(storyCandidates.map(c => c.text), lovableApiKey, 25, hnLogError);
        summary.classified += storyClassifications.length;
        summary.irrelevant += storyClassifications.filter(c => !c.relevant).length;

        // Pass 3: insert stories
        for (let i = 0; i < storyCandidates.length; i++) {
          const classification = storyClassifications[i];
          if (!classification.relevant) continue;
          const c = storyCandidates[i];

          for (const slug of c.matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, c.title, modelId)) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "hackernews", source_url: c.sourceUrl,
              title: c.title.slice(0, 500), content: c.title.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              praise_category: classification.praise_category,
              confidence: classification.confidence, content_type: "title_only",
              score: c.score, posted_at: c.postedAt,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(error.message); } else {
              summary.inserted++;
              existingUrls.add(c.sourceUrl);
              titleKeys.add(`${modelId}:${c.title.slice(0, 80).toLowerCase()}`);
            }
          }
        }
      } catch (e) { summary.errors.push(`Story ${term}: ${e instanceof Error ? e.message : "unknown"}`); }
      await delay(1000);
    }

    for (const term of COMMENT_SEARCH_TERMS) {
      try {
        const url = `${ALGOLIA_BASE}?query=${encodeURIComponent(term)}&tags=comment&numericFilters=created_at_i>${oneDayAgo}&hitsPerPage=30`;
        const res = await fetch(url);
        if (!res.ok) { await delay(1000); continue; }
        const data = await res.json();
        const hits = data.hits || [];
        summary.comments += hits.length;

        // Pass 1: collect comment candidates
        const commentCandidates: { text: string; matchedSlugs: string[]; sourceUrl: string; score: number; postedAt: string }[] = [];
        for (const hit of hits) {
          const text = (hit.comment_text || "").replace(/<[^>]*>/g, "");
          if (!text || !isEnglish(text)) continue;
          if (!meetsMinLength(text, "")) { summary.contentSkipped++; continue; }
          const sourceUrl = hit.story_id ? `https://news.ycombinator.com/item?id=${hit.story_id}` : `https://news.ycombinator.com/item?id=${hit.objectID}`;
          if (existingUrls.has(sourceUrl)) { summary.skipped++; continue; }

          const matchedSlugs = matchModels(text, keywords);
          if (matchedSlugs.length === 0) continue;

          commentCandidates.push({ text, matchedSlugs, sourceUrl, score: hit.points || 0, postedAt: hit.created_at || new Date().toISOString() });
        }

        // Pass 2: batch classify comments
        const hnCommentLogError = async (msg: string, ctx?: string) => {
          await logToErrorLog(supabase, "scrape-hackernews", msg, ctx || "classify");
        };
        const commentClassifications = await classifyBatch(commentCandidates.map(c => c.text), lovableApiKey, 25, hnCommentLogError);
        summary.classified += commentClassifications.length;
        summary.irrelevant += commentClassifications.filter(c => !c.relevant).length;

        // Pass 3: insert comments
        for (let i = 0; i < commentCandidates.length; i++) {
          const classification = commentClassifications[i];
          if (!classification.relevant) continue;
          const c = commentCandidates[i];

          for (const slug of c.matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, c.text.slice(0, 200), modelId)) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "hackernews", source_url: c.sourceUrl,
              title: c.text.slice(0, 200), content: c.text.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              praise_category: classification.praise_category,
              confidence: classification.confidence, content_type: "full_content",
              score: c.score, posted_at: c.postedAt,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(error.message); } else {
              summary.inserted++;
              existingUrls.add(c.sourceUrl);
              titleKeys.add(`${modelId}:${c.text.slice(0, 80).toLowerCase()}`);
            }
          }
        }
      } catch (e) { summary.errors.push(`Comment ${term}: ${e instanceof Error ? e.message : "unknown"}`); }
      await delay(1000);
    }

    await logToErrorLog(supabase, "scrape-hackernews", `Algolia: inserted=${summary.inserted} stories=${summary.stories} comments=${summary.comments} classified=${summary.classified} irrelevant=${summary.irrelevant}`, `skipped=${summary.skipped} errors=${summary.errors.length}`);
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-hackernews", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
