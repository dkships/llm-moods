import { normalizeComplaintCategory, normalizePraiseCategory, normalizeSentiment } from "./taxonomy.ts";

const API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODEL = "gemini-2.5-flash";
type DenoGlobal = typeof globalThis & {
  Deno?: { env: { get(name: string): string | undefined } };
};
type JsonRecord = Record<string, unknown>;
type QuotaClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function envValue(name: string, fallback: string): string {
  return (globalThis as DenoGlobal).Deno?.env.get(name) ?? fallback;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const DAILY_REQUEST_LIMIT = Number(envValue("GEMINI_DAILY_REQUEST_LIMIT", "200"));
const MINUTE_REQUEST_LIMIT = Number(envValue("GEMINI_MINUTE_REQUEST_LIMIT", "8"));
const MAX_REMOTE_429_RETRY_WAIT_MS = Number(envValue("GEMINI_429_MAX_RETRY_WAIT_MS", "65000"));
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const SAFE_ERROR_HEADERS = [
  "retry-after",
  "x-ratelimit-limit-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens",
  "x-request-id",
  "x-goog-request-id",
];

export const CLASSIFY_PROMPT = `You are classifying a social media post about AI language models (ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, etc).

STEP 1 — RELEVANCE
Is this post expressing a PERSONAL opinion about an AI model's quality, behavior, or usefulness based on direct or reported experience?
- RELEVANT: direct experience, quality complaints/praise, model comparisons, switching decisions, user-reported quality trends
  Examples: "Claude keeps refusing my coding requests", "GPT-4 just hallucinated my bibliography", "Claude is way better than GPT for coding", "has anyone noticed Gemini getting worse?", "I switched from ChatGPT to Claude"
- NOT RELEVANT:
  - News articles or research reporting: "PsyPost: ChatGPT acts as a cognitive crutch", "MIT Tech Review: 2025 is the year of AI hype correction", "ChatGPT Global Outage: OpenAI's Critical Disclosure"
  - Societal/behavioral commentary about AI in general: "In 10 years will anyone know how to code?", "People are becoming dependent on AI", "A person spending 300 hours with ChatGPT going deranged"
  - Third-party business decisions that mention a model: "DeviantArt added a Grok video generator", "Company X is using ChatGPT for interviews"
  - Benchmark/spec reporting without personal opinion: "Gemini 3 Flash: 218 tokens/sec vs GPT-4.5: 125 t/s"
  - Pricing observations without quality judgment: "ChatGPT costs the same as a Starbucks drink"
  - Pure news/funding/company strategy: "OpenAI raised $6B", "Sam Altman tweeted about AGI"
  - Tutorials with no quality opinion: "Here's a tutorial on using the ChatGPT API"
  - Ads, affiliate posts, newsletter promos, product launch/integration announcements, or company marketing unless the author gives direct model-quality experience
  - Posts where the model is mentioned but the opinion is about something else entirely (a platform, a person, society)

KEY TEST: Ask yourself "Is this person expressing satisfaction or frustration with the MODEL ITSELF based on using it?" If no → not relevant.

If not relevant, return {"relevant": false, "sentiment": null, "complaint_category": null, "praise_category": null, "confidence": 0.0, "language": null, "english_translation": null}

STEP 1b — LANGUAGE
If the post is NOT in English, detect the language (ISO 639-1 code, e.g. "ja", "ko", "zh", "de", "fr", "es", "pt") and provide a concise English translation. Classify sentiment based on the translated meaning.
If the post IS in English, set "language" to null and "english_translation" to null.

STEP 2 — SENTIMENT
- "positive": Praising quality, impressed by output, favorably comparing to alternatives, expressing satisfaction
- "negative": Complaining about quality, frustrated with output, unfavorably comparing, expressing disappointment
- "neutral": Genuinely mixed or purely factual comparison with no opinion. This should be RARE — most relevant posts express clear sentiment. When ambiguous, lean toward the expressed emotion.

IMPORTANT: If the post describes switching away from, leaving, or replacing this model, that is NEGATIVE sentiment — even if the overall tone is positive. "I'm happily moving to X, done with Y" is negative for Y. Conversely, if someone is switching TO this model, that is POSITIVE for it.

IMPORTANT: Watch for sarcasm and irony. If the surface tone seems positive but the underlying meaning is critical or mocking, classify based on the TRUE intent. Example: "At least ChatGPT would be sycophants who read books" is NEGATIVE (calling the model sycophantic), not positive.

STEP 3 — CATEGORY
If negative, set complaint_category to one of: lazy_responses, hallucinations, refusals, coding_quality, speed, general_drop, pricing_value, censorship, context_window, api_reliability, multimodal_quality, reasoning
If positive, set praise_category to one of: output_quality, coding_quality, speed, reasoning, creativity, value, reliability, context_handling, multimodal_quality, general_improvement
If neutral, both should be null.

Category guidance:
- hallucinations: The model generated factually incorrect information. NOT someone using the model to generate content.
- censorship: The model refused content due to safety filters. NOT copyright concerns about AI-generated content.
- general_drop: Quality declined compared to before. NOT societal concerns about AI dependency.
- lazy_responses: Short, generic, or low-effort text responses. NOT image/video generation artifacts (use multimodal_quality).
- multimodal_quality: Issues with image, video, or audio generation quality.

STEP 4 — CONFIDENCE (0.0-1.0)
- 0.9-1.0: Explicitly names a model AND has clear sentiment from direct experience ("Claude 3.5 is amazing at code")
- 0.7-0.8: Clearly about a model with discernible sentiment, but less direct
- 0.5-0.6: Ambiguous — could be about this model, or sentiment is unclear
- Below 0.5: Weak signal, likely not relevant

Return ONLY valid JSON:
{"result":{"relevant": true/false, "sentiment": "positive"/"negative"/"neutral"/null, "complaint_category": "<category>"/null, "praise_category": "<category>"/null, "confidence": 0.0-1.0, "language": "<iso-code>"/null, "english_translation": "<translation>"/null}}

Post to classify: `;

const BATCH_CLASSIFY_PROMPT = `You are classifying social media posts about AI language models (ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, etc).

For EACH post, determine:

RELEVANCE: Is this post expressing a PERSONAL opinion about an AI model's quality, behavior, or usefulness based on direct or reported experience?
- RELEVANT: direct experience, quality complaints/praise, model comparisons, switching decisions, user-reported quality trends
  Examples: "Claude keeps refusing my coding requests", "GPT-4 just hallucinated my bibliography", "Claude is way better than GPT for coding", "has anyone noticed Gemini getting worse?", "I switched from ChatGPT to Claude"
- NOT RELEVANT:
  - News/research reporting: "PsyPost: ChatGPT acts as a cognitive crutch", "MIT Tech Review: 2025 is the year of AI hype correction"
  - Societal/behavioral commentary: "In 10 years will anyone know how to code?", "People are becoming dependent on AI"
  - Third-party business decisions mentioning a model: "DeviantArt added a Grok video generator"
  - Benchmark/spec comparisons without personal opinion: "Gemini 3 Flash: 218 tokens/sec vs GPT-4.5: 125 t/s"
  - Pricing observations without quality judgment: "ChatGPT costs the same as a Starbucks drink"
  - Pure news/funding/company strategy: "OpenAI raised $6B"
  - Ads, affiliate posts, newsletter promos, product launch/integration announcements, or company marketing unless the author gives direct model-quality experience
  - Posts where the model is mentioned but the opinion is about something else (a platform, a person, society)

KEY TEST: "Is this person expressing satisfaction or frustration with the MODEL ITSELF based on using it?" If no → not relevant.

LANGUAGE: If a post is NOT in English, detect the language (ISO 639-1 code) and provide a concise English translation. Classify sentiment based on the translated meaning. If the post IS in English, set both to null.

SENTIMENT (if relevant):
- "positive": praising, impressed, satisfied
- "negative": complaining, frustrated, disappointed
- "neutral": genuinely mixed or purely factual (should be RARE)

IMPORTANT: If the post describes switching away from, leaving, or replacing the model being discussed, that is NEGATIVE sentiment — even if the overall tone is positive. "I'm happily moving to X, done with Y" is negative for Y. Conversely, if someone is switching TO the model, that is POSITIVE.

IMPORTANT: Watch for sarcasm and irony. Classify based on TRUE intent, not surface tone. "At least ChatGPT would be sycophants" is NEGATIVE.

CATEGORY (if relevant):
If negative: lazy_responses, hallucinations, refusals, coding_quality, speed, general_drop, pricing_value, censorship, context_window, api_reliability, multimodal_quality, reasoning
If positive: output_quality, coding_quality, speed, reasoning, creativity, value, reliability, context_handling, multimodal_quality, general_improvement

Category guidance: hallucinations = model generated false info (NOT someone using the model to generate content). censorship = model refused due to safety filters (NOT copyright concerns). general_drop = quality declined (NOT societal AI concerns). lazy_responses = low-effort text (NOT image/video artifacts — use multimodal_quality).

CONFIDENCE: 0.0-1.0 (0.9+ = explicit model name + clear sentiment from direct experience, 0.7-0.8 = clear but indirect, below 0.5 = weak)

Return ONLY a JSON object with one result per post in the same order:
{"results":[{"relevant": true/false, "sentiment": "..."/null, "complaint_category": "..."/null, "praise_category": "..."/null, "confidence": 0.0-1.0, "language": "..."/null, "english_translation": "..."/null}, ...]}

Posts to classify:
`;

const BATCH_CLASSIFY_TARGETED_PROMPT = `You are classifying social media posts about AI language models. Each post has a TARGET MODEL indicated in brackets. You must classify the sentiment SPECIFICALLY TOWARD that target model.

IMPORTANT: A post may mention multiple AI models. Focus ONLY on what it says about the TARGET model. For example:
- "DeepSeek just debugged a massive Stripe mess that Gemini made" → [TARGET: Gemini] = NEGATIVE (Gemini made a mess), [TARGET: DeepSeek] = POSITIVE (DeepSeek fixed it)
- "I switched from ChatGPT to Claude and it's so much better" → [TARGET: Claude] = POSITIVE, [TARGET: ChatGPT] = NEGATIVE
- "I'm settling into Mistral comfortably, with the desire to let go of ChatGPT" → [TARGET: ChatGPT] = NEGATIVE (wants to leave), [TARGET: Mistral] = POSITIVE (settling in happily)

CONTRAST PATTERNS — read carefully, the surface tone often misleads:
- "ChatGPT can be misleading and overreaching, which Claude is not as good at" → [TARGET: Claude] = NEGATIVE (the "not as good at" applies to Claude per the sentence structure — it's saying Claude IS misleading too, just less skillfully). Look at what adjectives ATTACH to the target by sentence structure, not what's nearby.
- "Claude nailed the reasoning, but ChatGPT excels at prose" → [TARGET: Claude] = POSITIVE (nailed reasoning), [TARGET: ChatGPT] = POSITIVE (excels at prose). Both can be positive.
- "Moving from ChatGPT to Claude because of hallucinations" → [TARGET: ChatGPT] = NEGATIVE (the reason for leaving is the target's flaw), [TARGET: Claude] = POSITIVE (chosen as replacement)
- "Gemini 3 outperforms Claude on benchmarks but Claude still wins on long context" → [TARGET: Gemini] = POSITIVE (outperforms), [TARGET: Claude] = POSITIVE (wins on long context). Comparative wins both ways.
- "X is faster than Y but less accurate" → [TARGET: X] = MIXED but lean POSITIVE if speed is the post's emphasis; [TARGET: Y] = the inverse. When two attributes trade off, pick the one the author seems to weight more.

CRITICAL: The overall TONE of a sentence may differ from sentiment toward the TARGET model. Always ask: is the author expressing satisfaction or frustration with the TARGET specifically? Switching away from / leaving / replacing the target = NEGATIVE. Switching to / adopting / praising the target = POSITIVE.

DISAMBIGUATION RULE: When a sentence says "X is [adjective] which Y is not as good at", the [adjective] applies to BOTH X and Y — Y is just less proficient at being [adjective]. If [adjective] is negative ("misleading", "overreaching"), both targets are NEGATIVE. If [adjective] is positive ("careful", "thoughtful"), both are POSITIVE (with Y less so).

For EACH post, determine:

RELEVANCE: Is this post expressing a PERSONAL opinion about the TARGET model's quality, behavior, or usefulness based on direct or reported experience? If the target model is only mentioned in passing with no opinion about it, mark as not relevant.
- NOT RELEVANT: news/research reporting, societal commentary, third-party business decisions mentioning the model, benchmark/spec comparisons without personal opinion, ads/affiliate/newsletter/company marketing, product launch or integration announcements without direct model-quality experience, posts where the opinion is about something else (a platform, a person, society).
- KEY TEST: "Is this person expressing satisfaction or frustration with the TARGET MODEL ITSELF based on using it?" If no → not relevant.

LANGUAGE: If a post is NOT in English, detect the language (ISO 639-1 code) and provide a concise English translation. Classify sentiment based on the translated meaning. If the post IS in English, set both to null.

SENTIMENT (if relevant, toward the TARGET model only):
- "positive": praising, impressed, satisfied with the target model
- "negative": complaining, frustrated, disappointed with the target model
- "neutral": genuinely mixed or purely factual about the target model (should be RARE)

IMPORTANT: Watch for sarcasm and irony. Classify based on TRUE intent, not surface tone.

CATEGORY (if relevant):
If negative: lazy_responses, hallucinations, refusals, coding_quality, speed, general_drop, pricing_value, censorship, context_window, api_reliability, multimodal_quality, reasoning
If positive: output_quality, coding_quality, speed, reasoning, creativity, value, reliability, context_handling, multimodal_quality, general_improvement

Category guidance: hallucinations = model generated false info. censorship = model refused due to safety filters. general_drop = quality declined. lazy_responses = low-effort text (NOT image/video artifacts — use multimodal_quality).

CONFIDENCE: 0.0-1.0 (0.9+ = explicit target model name + clear sentiment from direct experience, 0.7-0.8 = clear but indirect, below 0.5 = weak)

Return ONLY a JSON object with one result per post in the same order:
{"results":[{"relevant": true/false, "sentiment": "..."/null, "complaint_category": "..."/null, "praise_category": "..."/null, "confidence": 0.0-1.0, "language": "..."/null, "english_translation": "..."/null}, ...]}

Posts to classify:
`;

export type ClassifierStatus = "classified" | "irrelevant" | "classifier_error" | "parse_error" | "quota_deferred";

export interface ClassifyResult {
  relevant: boolean;
  sentiment: string | null;
  complaint_category: string | null;
  praise_category: string | null;
  confidence: number;
  language?: string | null;
  english_translation?: string | null;
  status?: ClassifierStatus;
  error?: string | null;
  error_type?: string | null;
  request_error_id?: string | null;
  retry_after_ms?: number | null;
}

interface SkippedResultMetadata {
  error_type?: string | null;
  request_error_id?: string | null;
  retry_after_ms?: number | null;
}

function makeSkippedResult(
  status: Exclude<ClassifierStatus, "classified" | "irrelevant">,
  error: string,
  metadata: SkippedResultMetadata = {},
): ClassifyResult {
  return {
    relevant: false,
    sentiment: null,
    complaint_category: null,
    praise_category: null,
    confidence: 0,
    status,
    error,
    error_type: metadata.error_type ?? null,
    request_error_id: metadata.request_error_id ?? null,
    retry_after_ms: metadata.retry_after_ms ?? null,
  };
}

const IRRELEVANT_RESULT: ClassifyResult = {
  relevant: false,
  sentiment: null,
  complaint_category: null,
  praise_category: null,
  confidence: 0,
  status: "irrelevant",
  error: null,
};

export function isClassifierFailure(result: ClassifyResult | undefined | null): boolean {
  return result?.status === "classifier_error"
    || result?.status === "parse_error"
    || result?.status === "quota_deferred";
}

export interface ClassifierFailureSummary {
  candidateFailures: number;
  requestFailures: number;
  quotaDeferred: number;
  parseErrors: number;
  classifierErrors: number;
  firstError: string | null;
  messages: string[];
}

export function summarizeClassifierFailures(
  results: ClassifyResult[],
  label = "Classifier",
): ClassifierFailureSummary {
  const failures = results.filter(isClassifierFailure);
  const requestErrorIds = new Set(
    failures
      .map((result) => result.request_error_id)
      .filter((id): id is string => Boolean(id)),
  );
  const quotaDeferred = failures.filter((result) => result.status === "quota_deferred").length;
  const parseErrors = failures.filter((result) => result.status === "parse_error").length;
  const classifierErrors = failures.filter((result) => result.status === "classifier_error").length;
  const firstError = failures.find((result) => result.error)?.error ?? null;
  const messages: string[] = [];

  if (quotaDeferred > 0) {
    const requestSuffix = requestErrorIds.size > 0
      ? ` across ${requestErrorIds.size} request${requestErrorIds.size === 1 ? "" : "s"}`
      : "";
    messages.push(`${label} quota deferred for ${quotaDeferred}/${results.length} candidates${requestSuffix}${firstError ? `: ${firstError}` : ""}`);
  }

  const nonQuotaFailures = failures.length - quotaDeferred;
  if (nonQuotaFailures > 0) {
    const requestSuffix = requestErrorIds.size > 0
      ? ` (${requestErrorIds.size} request-level failure${requestErrorIds.size === 1 ? "" : "s"})`
      : "";
    messages.push(`${label} failed for ${nonQuotaFailures}/${results.length} candidates${requestSuffix}${firstError ? `: ${firstError}` : ""}`);
  }

  return {
    candidateFailures: failures.length,
    requestFailures: requestErrorIds.size,
    quotaDeferred,
    parseErrors,
    classifierErrors,
    firstError,
    messages,
  };
}

function parseResult(value: unknown): ClassifyResult {
  const parsed = isRecord(value) ? value : {};
  const sentiment = normalizeSentiment(nullableString(parsed.sentiment));
  const complaintCategory = normalizeComplaintCategory(nullableString(parsed.complaint_category));
  const praiseCategory = normalizePraiseCategory(nullableString(parsed.praise_category));

  return {
    relevant: parsed.relevant !== false,
    sentiment,
    complaint_category: sentiment === "negative" ? complaintCategory : null,
    praise_category: sentiment === "positive" ? praiseCategory : null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    language: nullableString(parsed.language),
    english_translation: nullableString(parsed.english_translation),
    status: parsed.relevant === false ? "irrelevant" : "classified",
    error: null,
  };
}

function requestBody(prompt: string, maxTokens: number) {
  return JSON.stringify({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    temperature: 0,
    reasoning_effort: "none",
    response_format: { type: "json_object" },
  });
}

function retryAfterMs(res: Response | null): number | null {
  const retryAfter = res?.headers.get("retry-after");
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function retryDelayMs(res: Response | null, attempt: number): number {
  const explicitRetryAfter = retryAfterMs(res);
  if (explicitRetryAfter !== null) return explicitRetryAfter;
  const base = Math.min(20_000, 1_000 * (2 ** attempt));
  return Math.round(base * (0.5 + Math.random()));
}

let requestErrorSequence = 0;

function nextRequestErrorId(): string {
  requestErrorSequence = (requestErrorSequence + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${requestErrorSequence}`;
}

function clipped(value: unknown, maxLength = 220): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sanitizedHeaders(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of SAFE_ERROR_HEADERS) {
    const value = res.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

async function readGeminiFailure(res: Response): Promise<{
  reason: string;
  statusText: string | null;
  errorType: string | null;
  retryAfterMs: number | null;
  headers: Record<string, string>;
}> {
  const retryMs = retryAfterMs(res);
  let parsed: unknown = null;
  let raw: string | null = null;

  try {
    raw = await res.text();
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  const parsedRecord = isRecord(parsed) ? parsed : {};
  const error = isRecord(parsedRecord.error) ? parsedRecord.error : parsedRecord;
  const details = Array.isArray(error.details) ? error.details : [];
  const quotaViolation = details
    .flatMap((detail) => isRecord(detail) && Array.isArray(detail.violations) ? detail.violations.filter(isRecord) : [])
    .find((violation) => violation.quotaMetric || violation.quotaId || violation.quota_metric || violation.quota_id);
  const findDetailString = (key: string) => {
    const detail = details.find((entry) => isRecord(entry) && typeof entry[key] === "string");
    return isRecord(detail) ? detail[key] : undefined;
  };
  const statusText = clipped(error.status ?? error.type ?? parsedRecord.status ?? parsedRecord.type);
  const message = clipped(error.message ?? parsedRecord.message ?? raw, 260);
  const quotaReason = clipped(
    findDetailString("reason")
      ?? findDetailString("quota_limit")
      ?? findDetailString("quotaLimit")
      ?? quotaViolation?.quotaMetric
      ?? quotaViolation?.quotaId
      ?? quotaViolation?.quota_metric
      ?? quotaViolation?.quota_id
      ?? error.code,
    120,
  );
  const headers = sanitizedHeaders(res);
  const headerDetail = Object.entries(headers)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const parts = [
    `HTTP ${res.status}`,
    statusText,
    quotaReason,
    message,
    headerDetail || null,
  ].filter(Boolean);

  return {
    reason: parts.join(" | "),
    statusText,
    errorType: quotaReason ?? statusText,
    retryAfterMs: retryMs,
    headers,
  };
}

function nextMinuteDelayMs(): number {
  const msIntoMinute = Date.now() % 60_000;
  return (60_000 - msIntoMinute) + Math.round(Math.random() * 1_000);
}

let quotaClient: QuotaClient | null = null;

async function claimGeminiQuota(logError?: (msg: string, ctx?: string) => Promise<void>): Promise<ClassifyResult | null> {
  const supabaseUrl = (globalThis as DenoGlobal).Deno?.env.get("SUPABASE_URL");
  const serviceRoleKey = (globalThis as DenoGlobal).Deno?.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  if (!quotaClient) {
    const supabaseModuleUrl = "https://esm.sh/@supabase/supabase-js@2.45.4";
    const { createClient } = await import(supabaseModuleUrl) as { createClient: (url: string, key: string) => QuotaClient };
    quotaClient = createClient(supabaseUrl, serviceRoleKey);
  }
  const { data, error } = await quotaClient.rpc("claim_api_quota", {
    p_provider: "gemini",
    p_quota_key: MODEL,
    p_daily_limit: DAILY_REQUEST_LIMIT,
    p_minute_limit: MINUTE_REQUEST_LIMIT,
  });

  if (error) {
    if (logError) await logError(`Gemini quota gate error: ${error.message}`, "quota-error");
    return makeSkippedResult("classifier_error", "quota_gate_error");
  }

  const response = Array.isArray(data) ? data[0] : data;
  if (response && response.allowed === false) {
    const reason = response.reason || "quota_deferred";
    if (logError) await logError(`Gemini quota deferred: ${reason}`, "quota-deferred");
    return makeSkippedResult("quota_deferred", reason);
  }

  return null;
}

async function fetchGemini(
  prompt: string,
  apiKey: string,
  maxTokens: number,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<Response | ClassifyResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const quotaResult = await claimGeminiQuota(logError);
    if (quotaResult) {
      if (quotaResult.status === "quota_deferred" && quotaResult.error === "minute_limit" && attempt < 2) {
        const waitMs = nextMinuteDelayMs();
        if (logError) await logError(`Gemini minute quota deferred, retrying in ${waitMs}ms`, "quota-minute-wait");
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return quotaResult;
    }

    let res: Response | null = null;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: requestBody(prompt, maxTokens),
      });
    } catch (e) {
      if (attempt === 2) {
        return makeSkippedResult("classifier_error", e instanceof Error ? e.message : String(e));
      }
      await new Promise((r) => setTimeout(r, retryDelayMs(null, attempt)));
      continue;
    }

    if (res.ok) return res;

    if (res.status === 429) {
      const details = await readGeminiFailure(res);
      const requestErrorId = nextRequestErrorId();
      if (logError) {
        await logError(`Gemini request quota deferred (${requestErrorId}): ${details.reason}`, "classify-request-quota");
      }
      if (
        details.retryAfterMs !== null
        && details.retryAfterMs > 0
        && details.retryAfterMs <= MAX_REMOTE_429_RETRY_WAIT_MS
        && attempt < 2
      ) {
        if (logError) {
          await logError(
            `Gemini 429 retry-after ${details.retryAfterMs}ms, retrying request ${requestErrorId} (attempt ${attempt + 1}/3)`,
            "classify-request-retry-after",
          );
        }
        await new Promise((r) => setTimeout(r, details.retryAfterMs!));
        continue;
      }

      return makeSkippedResult("quota_deferred", details.reason, {
        error_type: details.errorType ?? "RESOURCE_EXHAUSTED",
        request_error_id: requestErrorId,
        retry_after_ms: details.retryAfterMs,
      });
    }

    if (!TRANSIENT_STATUSES.has(res.status) || attempt === 2) {
      const details = await readGeminiFailure(res);
      const requestErrorId = nextRequestErrorId();
      if (logError) await logError(`Gemini request failed (${requestErrorId}): ${details.reason}`, "classify-request-error");
      return makeSkippedResult("classifier_error", details.reason, {
        error_type: details.errorType,
        request_error_id: requestErrorId,
        retry_after_ms: details.retryAfterMs,
      });
    }

    const waitMs = retryDelayMs(res, attempt);
    if (logError) await logError(`Gemini HTTP ${res.status}, retrying in ${waitMs}ms (attempt ${attempt + 1}/3)`, "classify-retry");
    await new Promise((r) => setTimeout(r, waitMs));
  }

  return makeSkippedResult("classifier_error", "retry_exhausted");
}

export async function classifyPost(
  text: string,
  apiKey: string,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<ClassifyResult> {
  try {
    const res = await fetchGemini(CLASSIFY_PROMPT + text.slice(0, 600), apiKey, 700, logError);
    if (!(res instanceof Response)) {
      if (logError) await logError(`AI gateway ${res.status}: ${res.error}`, "classify-error");
      return res;
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
    } catch {
      if (logError) await logError(`AI gateway returned unparseable response: ${raw.slice(0, 200)}`, "classify-parse-error");
      return makeSkippedResult("parse_error", "unparseable_response");
    }
    return parseResult(isRecord(parsed) ? parsed.result ?? parsed : parsed);
  } catch (e) {
    if (logError) await logError(`classifyPost exception: ${e instanceof Error ? e.message : String(e)}`, "classify-exception");
    return makeSkippedResult("classifier_error", e instanceof Error ? e.message : String(e));
  }
}

async function batchClassifyWithPrompt(
  prompt: string,
  numbered: string,
  batchLength: number,
  apiKey: string,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<ClassifyResult[]> {
  const res = await fetchGemini(prompt + numbered, apiKey, 4096, logError);
  if (!(res instanceof Response)) {
    if (logError) await logError(`Batch classify ${res.status}: ${res.error}`, "batch-classify-error");
    return Array.from({ length: batchLength }, () => res);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const trimmed = raw.trim();
  const jsonMatch = trimmed.startsWith("[")
    ? trimmed.match(/\[[\s\S]*\]/)
    : trimmed.match(/\{[\s\S]*\}/) || trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    if (logError) await logError(`Batch classify unparseable: ${raw.slice(0, 200)}`, "batch-classify-parse");
    return Array.from({ length: batchLength }, () => makeSkippedResult("parse_error", "unparseable_response"));
  }
  const parsed = JSON.parse(jsonMatch[0]) as unknown;
  const parsedResults = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.results : null;
  if (!Array.isArray(parsedResults)) {
    return Array.from({ length: batchLength }, () => makeSkippedResult("parse_error", "missing_results_array"));
  }
  const results: ClassifyResult[] = [];
  for (let j = 0; j < batchLength; j++) {
    results.push(j < parsedResults.length ? parseResult(parsedResults[j]) : IRRELEVANT_RESULT);
  }
  return results;
}

export async function classifyBatch(
  texts: string[],
  apiKey: string,
  batchSize = 25,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<ClassifyResult[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await classifyPost(texts[0], apiKey, logError)];

  const allResults: ClassifyResult[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const numbered = batch.map((t, j) => `Post ${j + 1}: "${t.slice(0, 600)}"`).join("\n\n");
    try {
      const results = await batchClassifyWithPrompt(BATCH_CLASSIFY_PROMPT, numbered, batch.length, apiKey, logError);
      allResults.push(...results);
      if (i + batchSize < texts.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      if (logError) await logError(`Batch classify exception: ${e instanceof Error ? e.message : String(e)}`, "batch-classify-exception");
      allResults.push(...batch.map(() => makeSkippedResult("classifier_error", e instanceof Error ? e.message : String(e))));
    }
  }
  return allResults;
}

export async function classifyBatchTargeted(
  items: { text: string; targetModel: string }[],
  apiKey: string,
  batchSize = 25,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<ClassifyResult[]> {
  if (items.length === 0) return [];

  const allResults: ClassifyResult[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const numbered = batch.map((item, j) => `Post ${j + 1} [TARGET: ${item.targetModel}]: "${item.text.slice(0, 600)}"`).join("\n\n");
    try {
      const results = await batchClassifyWithPrompt(BATCH_CLASSIFY_TARGETED_PROMPT, numbered, batch.length, apiKey, logError);
      allResults.push(...results);
      if (i + batchSize < items.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      if (logError) await logError(`Targeted classify exception: ${e instanceof Error ? e.message : String(e)}`, "targeted-classify-exception");
      allResults.push(...batch.map(() => makeSkippedResult("classifier_error", e instanceof Error ? e.message : String(e))));
    }
  }
  return allResults;
}
