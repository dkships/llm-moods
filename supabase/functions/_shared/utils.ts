export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHATGPT_EXPLICIT_PATTERNS = [
  /\bchat\s?gpt\b/i,
  /\bgpt[-\s]?4o\b/i,
  /\bgpt[-\s]?5(?:\.4)?\b/i,
  /\bo4(?:-mini)?\b/i,
];

const LOCAL_GPT_MODEL_PATTERNS = [
  /\bgpt[:\-\s]?oss\b/i,
  /\boss[-\s]?(?:20b|120b)\b/i,
  /\bself-?hosted\b/i,
  /\blocal llms?\b/i,
  /\bhome lab\b/i,
  /\bollama\b/i,
  /\blm studio\b/i,
  /huggingface\.co\/openai\/gpt-oss/i,
];

export interface KeywordEntry { keyword: string; tier: string; context_words: string | null; model_slug: string; }

export async function loadKeywords(supabase: any): Promise<{ modelMap: Record<string, string>; keywords: KeywordEntry[] }> {
  const { data: models } = await supabase.from("models").select("id, slug");
  const modelMap: Record<string, string> = {};
  const slugById: Record<string, string> = {};
  for (const m of models || []) { modelMap[m.slug] = m.id; slugById[m.id] = m.slug; }
  const { data: kws } = await supabase.from("model_keywords").select("keyword, tier, context_words, model_id");
  const keywords: KeywordEntry[] = (kws || []).map((k: any) => ({
    keyword: k.keyword, tier: k.tier, context_words: k.context_words, model_slug: slugById[k.model_id] || "",
  }));
  return { modelMap, keywords };
}

function hasExplicitChatGptMarker(text: string): boolean {
  return CHATGPT_EXPLICIT_PATTERNS.some((pattern) => pattern.test(text));
}

function isLikelyLocalGptModelReference(text: string): boolean {
  return LOCAL_GPT_MODEL_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldSkipAmbiguousMatch(text: string, entry: KeywordEntry): boolean {
  if (entry.model_slug !== "chatgpt") return false;
  if (entry.keyword !== "gpt" && entry.keyword !== "openai") return false;
  if (hasExplicitChatGptMarker(text)) return false;
  return isLikelyLocalGptModelReference(text);
}

export function matchModels(text: string, keywords: KeywordEntry[], communitySlugMap?: Record<string, string>, communityName?: string): string[] {
  const matched: string[] = [];
  if (communityName && communitySlugMap) {
    const subSlug = communitySlugMap[communityName];
    if (subSlug && !matched.includes(subSlug)) matched.push(subSlug);
  }
  const lower = text.toLowerCase();
  const highKws = keywords.filter(k => k.tier === "high").sort((a, b) => b.keyword.length - a.keyword.length);
  for (const k of highKws) {
    if (matched.includes(k.model_slug)) continue;
    const regex = new RegExp(`\\b${k.keyword.replace(/[-\.]/g, "[-\\s.]?")}\\b`, "i");
    if (regex.test(lower)) matched.push(k.model_slug);
  }
  const ambigKws = keywords.filter(k => k.tier === "ambiguous");
  for (const k of ambigKws) {
    if (matched.includes(k.model_slug)) continue;
    const regex = new RegExp(`\\b${k.keyword.replace(/[-\.]/g, "[-\\s.]?")}\\b`, "i");
    if (!regex.test(lower)) continue;
    if (shouldSkipAmbiguousMatch(lower, k)) continue;
    if (!k.context_words) { matched.push(k.model_slug); continue; }
    const contextList = k.context_words.split(",").map(w => w.trim().toLowerCase());
    if (contextList.some(cw => lower.includes(cw))) matched.push(k.model_slug);
  }
  return matched;
}

export function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/<[^>]*>/g, "").trim();
}

export function meetsMinLength(title: string, content: string): boolean {
  return stripUrls(`${title} ${content}`).replace(/\s+/g, " ").trim().length >= 20;
}

export async function loadRecentTitleKeys(supabase: any): Promise<Set<string>> {
  const since = new Date(Date.now() - 48 * 3600000).toISOString();
  const { data } = await supabase.from("scraped_posts").select("title, model_id").gte("posted_at", since).not("title", "is", null);
  const keys = new Set<string>();
  for (const p of data || []) if (p.title) keys.add(`${p.model_id}:${p.title.slice(0, 80).toLowerCase()}`);
  return keys;
}

export function isDuplicate(titleKeys: Set<string>, title: string, modelId: string): boolean {
  return titleKeys.has(`${modelId}:${title.slice(0, 80).toLowerCase()}`);
}

export function isLikelyNewsShare(title: string, content: string): boolean {
  const text = `${title} ${content}`.trim();
  // Pattern: "Source Name: headline text... URL" — common on Mastodon
  if (/^[A-Z][\w\s&'-]+:\s.{20,}https?:\/\//.test(text)) return true;
  // Mostly a URL with minimal commentary (under 40 chars of non-URL text)
  const stripped = stripUrls(text).replace(/\s+/g, " ").trim();
  const urls = text.match(/https?:\/\/\S+/g) || [];
  if (urls.length > 0 && stripped.length < 40) return true;
  // Emoji-prefixed news headlines (📰, 🔗, etc.)
  if (/^[\u{1F4F0}\u{1F517}\u{1F4E2}\u{2757}]\s*[A-Z][\w\s]+:/u.test(text)) return true;
  return false;
}

export async function logToErrorLog(supabase: any, functionName: string, msg: string, ctx?: string) {
  try { await supabase.from("error_log").insert({ function_name: functionName, error_message: msg, context: ctx || null }); } catch (e) { console.error("logToErrorLog failed:", msg, e); }
}

export async function triggerAggregateVibes(supabase: any, source: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/aggregate-vibes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "no body");
      await logToErrorLog(
        supabase,
        source,
        `aggregate-vibes trigger failed HTTP ${res.status}: ${text.slice(0, 300)}`,
        "aggregate-trigger",
      );
    }
  } catch (error) {
    await logToErrorLog(
      supabase,
      source,
      `aggregate-vibes trigger exception: ${error instanceof Error ? error.message : String(error)}`,
      "aggregate-trigger",
    );
  }
}
