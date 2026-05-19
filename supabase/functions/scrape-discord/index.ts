import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import {
 createRunRecord,
 deriveRunMetrics,
 isUniqueViolation,
 readJsonBody,
 type RunRecordRow,
 updateRunRecord,
} from "../_shared/runtime.ts";
import {
 corsHeaders,
 loadKeywords,
 matchModels,
 meetsMinLength,
 isLikelyNewsShare,
 loadRecentTitleKeys,
 isDuplicate,
 logToErrorLog,
 triggerAggregateVibes,
 upsertScrapedPost,
} from "../_shared/utils.ts";

const SOURCE = "scrape-discord";

async function fetchWithTimeout(
 url: string,
 options: RequestInit = {},
 timeoutMs = 15000,
): Promise<Response> {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), timeoutMs);
 try {
 return await fetch(url, { ...options, signal: controller.signal });
 } finally {
 clearTimeout(timer);
 }
}

function delay(ms: number) {
 return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DiscordMessage {
 id: string;
 content: string;
 timestamp: string;
 author: {
 id: string;
 username: string;
 };
 channel_id: string;
 mentions: any[];
 attachments: any[];
 embeds: any[];
}

async function fetchDiscordMessages(
 channelId: string,
 botToken: string,
 limit = 100,
 beforeMessageId?: string
): Promise<DiscordMessage[]> {
 const url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}${beforeMessageId ? `&before=${beforeMessageId}` : ''}`;
 
 const res = await fetchWithTimeout(url, {
 headers: {
 Authorization: `Bot ${botToken}`,
 Accept: "application/json",
 },
 });
 
 if (!res.ok) {
 const text = await res.text();
 throw new Error(`Discord API error: ${res.status} - ${text.slice(0, 200)}`);
 }
 
 return await res.json();
}

async function getChannelInfo(channelId: string, botToken: string): Promise<any> {
 const url = `https://discord.com/api/v10/channels/${channelId}`;
 
 const res = await fetchWithTimeout(url, {
 headers: {
 Authorization: `Bot ${botToken}`,
 Accept: "application/json",
 },
 });
 
 if (!res.ok) {
 const text = await res.text();
 throw new Error(`Discord API error: ${res.status} - ${text.slice(0, 200)}`);
 }
 
 return await res.json();
}

Deno.serve(async (req) => {
 if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

 const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const body = await readJsonBody(req);
 let runRecord: RunRecordRow | null = null;

 try {
 const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
 if (!geminiApiKey) throw new Error("GEMINI_API_KEY not configured");

 const { data: startedRun, error: runError } = await createRunRecord(supabase, {
 source: SOURCE,
 run_kind: "scraper",
 status: "running",
 parent_run_id: typeof body.parent_run_id === "string" ? body.parent_run_id : null,
 triggered_by: body.orchestrated ? "orchestrator" : "manual",
 window_label: typeof body.window_label === "string" ? body.window_label : null,
 window_local_date: typeof body.window_local_date === "string" ? body.window_local_date : null,
 timezone: typeof body.timezone === "string" ? body.timezone : null,
 started_at: new Date().toISOString(),
 });

 if (runError) {
 if (isUniqueViolation(runError)) {
 return new Response(JSON.stringify({
 source: SOURCE,
 status: "skipped",
 skipped: true,
 reason: "already_running",
 errors: [],
 }), {
 headers: { ...corsHeaders, "Content-Type": "application/json" },
 });
 }
 throw runError;
 }
 runRecord = startedRun;

 const discordBotToken = Deno.env.get("DISCORD_BOT_TOKEN");
 const discordChannelIds = Deno.env.get("DISCORD_CHANNEL_IDS");
 
 if (!discordBotToken || !discordChannelIds) {
 await logToErrorLog(supabase, SOURCE, "Missing DISCORD credentials", "auth");
 throw new Error("Missing Discord credentials");
 }

 const channelIds = discordChannelIds.split(',').map(id => id.trim()).filter(Boolean);
 if (channelIds.length === 0) {
 await logToErrorLog(supabase, SOURCE, "No Discord channel IDs configured", "auth");
 throw new Error("No Discord channel IDs configured");
 }

 await logToErrorLog(supabase, SOURCE, "Discord scraper started", "health-check");

 const { modelMap, keywords } = await loadKeywords(supabase);
 const { data: existing } = await supabase
 .from("scraped_posts")
 .select("source_url")
 .eq("source", "discord")
 .limit(10000);
 const existingUrls = new Set((existing || []).map((entry: any) => entry.source_url).filter(Boolean));
 const titleKeys = await loadRecentTitleKeys(supabase);

 const cutoff = new Date(Date.now() - 24 * 3600000);
 const summary = {
 source: SOURCE,
 posts_found: 0,
 filtered_candidates: 0,
 classified: 0,
 net_new_rows: 0,
 duplicate_conflicts: 0,
 irrelevant: 0,
 dedupSkipped: 0,
 contentSkipped: 0,
 errors: [] as string[],
 channels_processed: 0,
 };

 for (let i = 0; i < channelIds.length; i++) {
 const channelId = channelIds[i];
 if (i > 0) await delay(2000);

 try {
 const channelInfo = await getChannelInfo(channelId, discordBotToken);
 summary.channels_processed++;

 let messages: DiscordMessage[] = [];
 let lastMessageId: string | undefined;
 let fetchCount = 0;
 const maxFetches = 5;

 while (fetchCount < maxFetches) {
 const batchMessages = await fetchDiscordMessages(channelId, discordBotToken, 100, lastMessageId);
 
 if (batchMessages.length === 0) break;
 
 messages = messages.concat(batchMessages);
 
 const oldestMessage = batchMessages[batchMessages.length - 1];
 const oldestTimestamp = new Date(oldestMessage.timestamp);
 
 if (oldestTimestamp < cutoff) {
 messages = messages.filter(msg => new Date(msg.timestamp) >= cutoff);
 break;
 }
 
 lastMessageId = oldestMessage.id;
 fetchCount++;
 await delay(1000);
 }

 summary.posts_found += messages.length;

 const candidates: {
 text: string;
 matchedSlugs: string[];
 sourceUrl: string;
 createdAt: string;
 author: string;
 messageId: string;
 }[] = [];

 for (const message of messages) {
 const text = message.content || "";
 const createdAt = new Date(message.timestamp);
 
 if (createdAt < cutoff) continue;
 if (message.author.bot || !text.trim()) continue;

 if (!meetsMinLength(text, "")) {
 summary.contentSkipped++;
 continue;
 }

 if (isLikelyNewsShare(text, "")) {
 summary.contentSkipped++;
 continue;
 }

 const matchedSlugs = matchModels(text, keywords);
 if (matchedSlugs.length === 0) continue;
 summary.filtered_candidates++;

 const sourceUrl = `https://discord.com/channels/${channelInfo.guild_id || '@me'}/${channelId}/${message.id}`;
 
 if (existingUrls.has(sourceUrl)) {
 summary.dedupSkipped++;
 continue;
 }

 let allDuped = true;
 for (const slug of matchedSlugs) {
 const modelId = modelMap[slug];
 if (modelId && !isDuplicate(titleKeys, text.slice(0, 120), modelId)) {
 allDuped = false;
 break;
 }
 }
 if (allDuped) {
 summary.dedupSkipped++;
 continue;
 }

 candidates.push({
 text,
 matchedSlugs,
 sourceUrl,
 createdAt: createdAt.toISOString(),
 author: message.author.username,
 messageId: message.id,
 });
 }

 const discordLogError = async (msg: string, ctx?: string) => {
 await logToErrorLog(supabase, SOURCE, msg, ctx || "classify");
 };

 const classifications = await classifyBatch(candidates.map((candidate) => candidate.text), geminiApiKey, 25, discordLogError);
 summary.classified += classifications.length;
 summary.irrelevant += classifications.filter((classification) => !classification.relevant).length;

 const targetedItems: { idx: number; slug: string }[] = [];
 for (let index = 0; index < candidates.length; index++) {
 if (!classifications[index].relevant) continue;
 for (const slug of candidates[index].matchedSlugs) {
 targetedItems.push({ idx: index, slug });
 }
 }

 const targetedResults = targetedItems.length > 0
 ? await classifyBatchTargeted(
 targetedItems.map((item) => ({ text: candidates[item.idx].text, targetModel: item.slug })),
 geminiApiKey,
 25,
 discordLogError,
 )
 : [];
 const targetedMap = new Map<string, typeof classifications[0]>();
 targetedItems.forEach((item, index) => targetedMap.set(`${item.idx}:${item.slug}`, targetedResults[index]));

 for (let index = 0; index < candidates.length; index++) {
 const baseClassification = classifications[index];
 if (!baseClassification.relevant) continue;
 const candidate = candidates[index];

 for (const slug of candidate.matchedSlugs) {
 const classification = targetedMap.get(`${index}:${slug}`) || baseClassification;
 const modelId = modelMap[slug];
 if (!modelId || isDuplicate(titleKeys, candidate.text.slice(0, 120), modelId)) continue;

 const upsertResult = await upsertScrapedPost(supabase, {
 model_id: modelId,
 source: "discord",
 source_url: candidate.sourceUrl,
 title: `${candidate.author}: ${candidate.text.slice(0, 100)}`,
 content: candidate.text.slice(0, 2000),
 sentiment: classification.sentiment,
 complaint_category: classification.complaint_category,
 praise_category: classification.praise_category,
 confidence: classification.confidence,
 content_type: "full_content",
 original_language: classification.language || null,
 translated_content: classification.english_translation || null,
 score: 1,
 posted_at: candidate.createdAt,
 });

 if (upsertResult.error) {
 summary.errors.push(`Insert: ${upsertResult.error}`);
 continue;
 }

 if (upsertResult.inserted) {
 summary.net_new_rows++;
 existingUrls.add(candidate.sourceUrl);
 titleKeys.add(`${modelId}:${candidate.text.slice(0, 80).toLowerCase()}`);
 } else {
 summary.duplicate_conflicts++;
 }
 }
 }

 } catch (error) {
 summary.errors.push(`Channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
 }
 }

 const derived = deriveRunMetrics(summary);
 await updateRunRecord(supabase, runRecord!.id, {
 status: derived.status,
 posts_found: derived.posts_found,
 posts_classified: derived.posts_classified,
 filtered_candidates: derived.filtered_candidates,
 net_new_rows: derived.net_new_rows,
 duplicate_conflicts: derived.duplicate_conflicts,
 errors: derived.errors,
 metadata: {
 irrelevant: summary.irrelevant,
 dedup_skipped: summary.dedupSkipped,
 content_skipped: summary.contentSkipped,
 channels_processed: summary.channels_processed,
 },
 completed_at: new Date().toISOString(),
 });

 await logToErrorLog(
 supabase,
 SOURCE,
 `Completed: channels=${summary.channels_processed} posts=${summary.posts_found} filtered=${summary.filtered_candidates} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.net_new_rows}`,
 "summary",
 );

 const responseBody = {
 ...summary,
 status: derived.status,
 posts_classified: derived.posts_classified,
 };

 if (!body.orchestrated) {
 await triggerAggregateVibes(supabase, SOURCE, { reason: "standalone_run" });
 }

 return new Response(JSON.stringify(responseBody, null, 2), {
 headers: { ...corsHeaders, "Content-Type": "application/json" },
 });
 } catch (error) {
 const message = error instanceof Error ? error.message : "Unknown";
 await logToErrorLog(supabase, SOURCE, message, "top-level error");
 if (runRecord) {
 await updateRunRecord(supabase, runRecord!.id, {
 status: "failed",
 errors: [message],
 metadata: { error: message },
 completed_at: new Date().toISOString(),
 });
 }
 return new Response(JSON.stringify({ source: SOURCE, status: "failed", error: message }), {
 status: 500,
 headers: { ...corsHeaders, "Content-Type": "application/json" },
 });
 }
});
