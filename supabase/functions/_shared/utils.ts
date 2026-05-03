export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

declare const Deno: { env: { get(name: string): string | undefined } };

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

export function isLikelyPromotionalShare(title: string, content: string): boolean {
  const raw = `${title} ${content}`.trim();
  const stripped = stripUrls(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const lower = stripped.toLowerCase();
  const hasUrl = /https?:\/\/\S+/i.test(raw);
  const hasDirectExperience =
    /\b(?:i|we)\s+(?:asked|connected|debugged|hooked up|noticed|prefer|prompted|ran|rely|switched|tested|tried|use|used)\b/i.test(lower) ||
    /\bi(?:'ve| have| just)?\s+(?:asked|connected|debugged|hooked up|noticed|preferred|prompted|run|ran|relied|switched|tested|tried|used|been using)\b/i.test(lower) ||
    /\b(?:my|our)\s+(?:code|project|prompt|prompts|refactor|setup|usage|workflow)\b/i.test(lower);

  if (/\[\uAD11\uACE0\]/u.test(raw)) return true;
  if (/\b(affiliate|sponsored|paid partnership|partner link|coupon|referral)\b/i.test(lower)) return true;
  if (/\b(coupang partners|commission may be earned|as an amazon associate)\b/i.test(lower)) return true;

  const hasCta = /\b(book (?:a )?(?:call|demo|date)|coffee date|schedule (?:a )?(?:call|demo)|sign up|get started|try (?:it|now)|download now|subscribe to unlock|contact us|learn more)\b/i.test(lower);
  const hasPromoNoun = /\b(agency|course|newsletter|service|startup|template|webinar|whitepaper|workflow|product suite)\b/i.test(lower);
  if (hasCta && (hasUrl || hasPromoNoun) && !hasDirectExperience) return true;

  const looksLikeAnnouncement = /\b(announces?|became an api call|integration|integrations|launch(?:ed|es)?|now supports?|released?|rolls? out|unveils?)\b/i.test(lower);
  if (looksLikeAnnouncement && hasUrl && !hasDirectExperience) return true;

  return false;
}

export function isLikelyNonExperienceShare(title: string, content: string): boolean {
  return isLikelyNewsShare(title, content) || isLikelyPromotionalShare(title, content);
}

export async function logToErrorLog(supabase: any, functionName: string, msg: string, ctx?: string) {
  try { await supabase.from("error_log").insert({ function_name: functionName, error_message: msg, context: ctx || null }); } catch (e) { console.error("logToErrorLog failed:", msg, e); }
}

// Soft alert: logs a zero_data_warning to error_log when a scrape returns
// suspiciously few posts. Run status stays whatever the caller derived
// (usually `success`) — this just makes silent API failures visible in
// the admin error feed so ops can distinguish "quiet day" from "actor broken".
export async function logZeroDataWarning(
  supabase: any,
  source: string,
  postsFound: number,
  threshold = 5,
) {
  if (postsFound >= threshold) return;
  await logToErrorLog(
    supabase,
    source,
    `Zero/low data: posts_found=${postsFound} (threshold=${threshold})`,
    "zero_data_warning",
  );
}

export async function triggerAggregateVibes(supabase: any, source: string, payload: Record<string, unknown> = {}) {
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
      body: JSON.stringify({ source, ...payload }),
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

export async function upsertScrapedPost(
  supabase: any,
  payload: Record<string, unknown>,
): Promise<{ inserted: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("scraped_posts")
    .upsert(payload, { onConflict: "source_url,model_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    return { inserted: false, error: error.message };
  }

  return {
    inserted: Array.isArray(data) && data.length > 0,
    error: null,
  };
}
