import { normalizeComplaintCategory, normalizePraiseCategory, normalizeSentiment } from "./taxonomy.ts";

const API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "gemini-2.5-flash";
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
const EVAL_DAILY_REQUEST_LIMIT = Number(envValue("GEMINI_EVAL_DAILY_REQUEST_LIMIT", "20"));
const EVAL_MINUTE_REQUEST_LIMIT = Number(envValue("GEMINI_EVAL_MINUTE_REQUEST_LIMIT", "2"));
const MAX_REMOTE_429_RETRY_WAIT_MS = Number(envValue("GEMINI_429_MAX_RETRY_WAIT_MS", "65000"));
// 529 = Anthropic "overloaded"; treat as transient so overload events retry/defer
// rather than dead-lettering posts as a non-retryable classifier_error.
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);
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
  "anthropic-ratelimit-requests-limit",
  "anthropic-ratelimit-requests-remaining",
  "anthropic-ratelimit-tokens-limit",
  "anthropic-ratelimit-tokens-remaining",
  "anthropic-ratelimit-input-tokens-remaining",
  "anthropic-ratelimit-output-tokens-remaining",
  "request-id",
];

export interface UsageSample {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  // Anthropic prompt-cache reads, billed at 0.1x input. Null for Gemini.
  // Lets the eval harness price cached Sonnet runs fairly vs uncached Haiku.
  cacheReadTokens?: number | null;
  latencyMs: number;
  mode: "single" | "batch";
}

export interface ClassifyOptions {
  model?: string;
  quotaKey?: string;
  dailyLimit?: number;
  minuteLimit?: number;
  quotaScope?: "production" | "eval";
  onUsage?: (sample: UsageSample) => void | Promise<void>;
  // "none" (default) keeps current production behavior. "omit" leaves the
  // field unset entirely, which is required for thinking-only models like
  // gemini-2.5-pro that reject reasoning_effort=none with a 400.
  reasoningEffort?: "none" | "low" | "medium" | "high" | "omit";
  // Override max_tokens for the underlying request. Useful for thinking-only
  // models where the default 4096-token batch budget gets eaten by reasoning.
  maxTokensOverride?: number;
}

function classifierModel(options: ClassifyOptions = {}): string {
  // CLASSIFIER_MODEL is the provider-neutral knob; GEMINI_CLASSIFIER_MODEL is the
  // legacy name kept as a fallback so an existing secret keeps working.
  return options.model ?? envValue("CLASSIFIER_MODEL", envValue("GEMINI_CLASSIFIER_MODEL", DEFAULT_MODEL));
}

export type ClassifierProvider = "anthropic" | "gemini";

// Provider is selected by model-id prefix alone, so setting CLASSIFIER_MODEL (or
// passing options.model) is the only switch needed. claude-* → Anthropic native
// Messages API; everything else → Gemini's OpenAI-compatible endpoint.
export function providerForModel(model: string): ClassifierProvider {
  return model.toLowerCase().startsWith("claude") ? "anthropic" : "gemini";
}

// The active production model (env-driven) unless an explicit model is passed.
export function resolveClassifierModel(options: ClassifyOptions = {}): string {
  return classifierModel(options);
}

// Returns the API key for the active (or given) model's provider. Callers use
// this instead of reading GEMINI_API_KEY directly so a claude-* model gets the
// Anthropic key rather than a mismatched Gemini key.
export function getClassifierApiKey(model?: string): string | undefined {
  const provider = providerForModel(model ?? classifierModel());
  const env = (globalThis as DenoGlobal).Deno?.env;
  return provider === "anthropic" ? env?.get("ANTHROPIC_API_KEY") : env?.get("GEMINI_API_KEY");
}

function quotaKeyFor(model: string, options: ClassifyOptions = {}): string {
  const scope = options.quotaScope ?? "production";
  return options.quotaKey ?? (scope === "eval" ? `${model}:eval` : model);
}

function dailyLimitFor(options: ClassifyOptions = {}): number {
  if (options.dailyLimit !== undefined) return options.dailyLimit;
  return (options.quotaScope ?? "production") === "eval" ? EVAL_DAILY_REQUEST_LIMIT : DAILY_REQUEST_LIMIT;
}

function minuteLimitFor(options: ClassifyOptions = {}): number {
  if (options.minuteLimit !== undefined) return options.minuteLimit;
  return (options.quotaScope ?? "production") === "eval" ? EVAL_MINUTE_REQUEST_LIMIT : MINUTE_REQUEST_LIMIT;
}

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

function readUsageField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function emitUsage(
  options: ClassifyOptions,
  model: string,
  mode: "single" | "batch",
  responseData: unknown,
  startedAt: number,
): Promise<void> {
  if (!options.onUsage) return;
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  const usage = isRecord(responseData) && isRecord(responseData.usage) ? responseData.usage : null;
  const sample: UsageSample = {
    model,
    promptTokens: usage ? readUsageField(usage.prompt_tokens) : null,
    completionTokens: usage ? readUsageField(usage.completion_tokens) : null,
    totalTokens: usage ? readUsageField(usage.total_tokens) : null,
    cacheReadTokens: usage ? readUsageField(usage.cache_read_input_tokens) : null,
    latencyMs,
    mode,
  };
  try {
    await options.onUsage(sample);
  } catch {
    // Usage telemetry is best-effort; never let it break classification.
  }
}

function parseResult(value: unknown): ClassifyResult {
  if (!isRecord(value)) return makeSkippedResult("parse_error", "result_not_object");
  if (typeof value.relevant !== "boolean") return makeSkippedResult("parse_error", "missing_relevant_boolean");
  if (value.relevant === false) return IRRELEVANT_RESULT;

  const sentiment = normalizeSentiment(nullableString(value.sentiment));
  if (!sentiment) return makeSkippedResult("parse_error", "missing_or_invalid_sentiment");

  const rawConfidence = typeof value.confidence === "number" ? value.confidence : NaN;
  if (!Number.isFinite(rawConfidence)) return makeSkippedResult("parse_error", "missing_confidence");
  const confidence = Math.max(0, Math.min(1, rawConfidence));

  const complaintCategory = normalizeComplaintCategory(nullableString(value.complaint_category));
  const praiseCategory = normalizePraiseCategory(nullableString(value.praise_category));

  return {
    relevant: true,
    sentiment,
    complaint_category: sentiment === "negative" ? complaintCategory ?? "other" : null,
    praise_category: sentiment === "positive" ? praiseCategory : null,
    confidence,
    language: nullableString(value.language),
    english_translation: nullableString(value.english_translation),
    status: "classified",
    error: null,
  };
}

const CLASSIFICATION_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "relevant",
    "sentiment",
    "complaint_category",
    "praise_category",
    "confidence",
    "language",
    "english_translation",
  ],
  properties: {
    relevant: { type: "boolean" },
    sentiment: { type: ["string", "null"], enum: ["positive", "negative", "neutral", null] },
    complaint_category: {
      type: ["string", "null"],
      enum: [
        "lazy_responses",
        "hallucinations",
        "refusals",
        "coding_quality",
        "speed",
        "general_drop",
        "pricing_value",
        "censorship",
        "context_window",
        "api_reliability",
        "multimodal_quality",
        "reasoning",
        "other",
        null,
      ],
    },
    praise_category: {
      type: ["string", "null"],
      enum: [
        "output_quality",
        "coding_quality",
        "speed",
        "reasoning",
        "creativity",
        "value",
        "reliability",
        "context_handling",
        "multimodal_quality",
        "general_improvement",
        null,
      ],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    language: { type: ["string", "null"] },
    english_translation: { type: ["string", "null"] },
  },
};

function responseSchema(mode: "single" | "batch") {
  return mode === "single"
    ? {
      name: "llm_vibes_single_classification",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["result"],
        properties: { result: CLASSIFICATION_RESULT_SCHEMA },
      },
    }
    : {
      name: "llm_vibes_batch_classification",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["results"],
        properties: { results: { type: "array", items: CLASSIFICATION_RESULT_SCHEMA } },
      },
    };
}

function requestBody(prompt: string, maxTokens: number, mode: "single" | "batch", options: ClassifyOptions = {}) {
  const model = classifierModel(options);
  const effort = options.reasoningEffort ?? "none";
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: responseSchema(mode),
    },
  };
  if (effort !== "omit") {
    body.reasoning_effort = effort;
  }
  return JSON.stringify(body);
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

// Anthropic errors are shaped {type:"error", error:{type, message}} — different
// from Gemini's. Parse them so 429/529 carry a usable reason + retry-after rather
// than being mis-read by readGeminiFailure and dropped to a non-retryable error.
async function readAnthropicFailure(res: Response): Promise<{
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
  const errorType = clipped(error.type ?? parsedRecord.type, 120);
  const message = clipped(error.message ?? parsedRecord.message ?? raw, 260);
  const headers = sanitizedHeaders(res);
  const headerDetail = Object.entries(headers)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const parts = [`HTTP ${res.status}`, errorType, message, headerDetail || null].filter(Boolean);

  return {
    reason: parts.join(" | "),
    statusText: errorType,
    errorType,
    retryAfterMs: retryMs,
    headers,
  };
}

function nextMinuteDelayMs(): number {
  const msIntoMinute = Date.now() % 60_000;
  return (60_000 - msIntoMinute) + Math.round(Math.random() * 1_000);
}

let quotaClient: QuotaClient | null = null;

async function claimGeminiQuota(
  options: ClassifyOptions = {},
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<ClassifyResult | null> {
  const supabaseUrl = (globalThis as DenoGlobal).Deno?.env.get("SUPABASE_URL");
  const serviceRoleKey = (globalThis as DenoGlobal).Deno?.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  if (!quotaClient) {
    const supabaseModuleUrl = "https://esm.sh/@supabase/supabase-js@2.45.4";
    const { createClient } = await import(supabaseModuleUrl) as { createClient: (url: string, key: string) => QuotaClient };
    quotaClient = createClient(supabaseUrl, serviceRoleKey);
  }
  const model = classifierModel(options);
  const { data, error } = await quotaClient.rpc("claim_api_quota", {
    p_provider: "gemini",
    p_quota_key: quotaKeyFor(model, options),
    p_daily_limit: dailyLimitFor(options),
    p_minute_limit: minuteLimitFor(options),
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
  mode: "single" | "batch",
  logError?: (msg: string, ctx?: string) => Promise<void>,
  options: ClassifyOptions = {},
): Promise<Response | ClassifyResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const quotaResult = await claimGeminiQuota(options, logError);
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
        body: requestBody(prompt, maxTokens, mode, options),
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

// Tool whose input_schema wraps results exactly as the Gemini path returns them
// ({result} single / {results} batch), so the downstream JSON parser is shared.
// Forcing this tool guarantees schema-shaped output without prose JSON.
const ANTHROPIC_CLASSIFY_TOOL_NAME = "record_classifications";

function anthropicTool(mode: "single" | "batch") {
  const input_schema = mode === "single"
    ? {
      type: "object",
      additionalProperties: false,
      required: ["result"],
      properties: { result: CLASSIFICATION_RESULT_SCHEMA },
    }
    : {
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: { results: { type: "array", items: CLASSIFICATION_RESULT_SCHEMA } },
    };
  return {
    name: ANTHROPIC_CLASSIFY_TOOL_NAME,
    description: "Record the sentiment classification result(s) for the posts.",
    // NOTE: strict tool use (`strict: true`) is deliberately NOT enabled. Our
    // schema uses nullable union types (`type: ["string","null"]`) and null-in-enum,
    // which the structured-output / strict JSON Schema subset rejects with a 400
    // (verified in prod 2026-06-02 — every batch failed). Forced tool_choice already
    // yields schema-shaped output. Re-enabling strict needs an anyOf-based nullable
    // rewrite + live-API testing; tracked as a follow-up, not a drop-in flag.
    input_schema,
  };
}

function anthropicRequestBody(
  instructions: string,
  postsBlock: string,
  maxTokens: number,
  mode: "single" | "batch",
  options: ClassifyOptions = {},
): string {
  return JSON.stringify({
    model: classifierModel(options),
    max_tokens: maxTokens,
    // No `temperature`: current Claude models (Haiku 4.5 / Sonnet 4.6 / Opus)
    // reject it with "temperature is deprecated for this model". tool_choice
    // forcing already makes the classification output stable enough.
    // Static instruction prefix in a cached system block (1.5-2.5k tokens); the
    // per-call posts go in the user turn so the cache prefix is identical each
    // call. Sonnet/Opus (>=1024 min) cache; Haiku (4096 min) silently won't —
    // that's fine, Haiku is cheap. cache_control after system also caches tools.
    system: [{ type: "text", text: instructions, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: postsBlock }],
    tools: [anthropicTool(mode)],
    tool_choice: { type: "tool", name: ANTHROPIC_CLASSIFY_TOOL_NAME },
  });
}

// Re-shape Claude's Messages response into the OpenAI envelope the callers already
// parse: tool_use.input → JSON string at choices[0].message.content, and Anthropic
// usage fields mapped onto prompt/completion/total (+ cache_read for cost).
function anthropicAsOpenAiResponse(data: unknown): Response {
  const record = isRecord(data) ? data : {};
  const content = Array.isArray(record.content) ? record.content : [];
  const toolUse = content.find((block) => isRecord(block) && block.type === "tool_use" && isRecord(block.input));
  const input = isRecord(toolUse) ? toolUse.input : {};
  const usage = isRecord(record.usage) ? record.usage : {};
  const inputTokens = readUsageField(usage.input_tokens) ?? 0;
  const cacheCreate = readUsageField(usage.cache_creation_input_tokens) ?? 0;
  const cacheRead = readUsageField(usage.cache_read_input_tokens) ?? 0;
  const outputTokens = readUsageField(usage.output_tokens);
  // promptTokens = freshly-billed input (uncached + cache write). cache_read is
  // carried separately so the harness can price it at 0.1x.
  const promptTokens = inputTokens + cacheCreate;
  const synthetic = {
    choices: [{ message: { content: JSON.stringify(input) } }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: outputTokens,
      total_tokens: promptTokens + cacheRead + (outputTokens ?? 0),
      cache_read_input_tokens: cacheRead,
    },
  };
  return new Response(JSON.stringify(synthetic), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function fetchAnthropic(
  instructions: string,
  postsBlock: string,
  apiKey: string,
  maxTokens: number,
  mode: "single" | "batch",
  logError?: (msg: string, ctx?: string) => Promise<void>,
  options: ClassifyOptions = {},
): Promise<Response | ClassifyResult> {
  const body = anthropicRequestBody(instructions, postsBlock, maxTokens, mode, options);
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (e) {
      if (attempt === 2) return makeSkippedResult("classifier_error", e instanceof Error ? e.message : String(e));
      await new Promise((r) => setTimeout(r, retryDelayMs(null, attempt)));
      continue;
    }

    if (res.ok) return anthropicAsOpenAiResponse(await res.json());

    if (res.status === 429 || res.status === 529) {
      const details = await readAnthropicFailure(res);
      const requestErrorId = nextRequestErrorId();
      if (logError) {
        await logError(`Anthropic ${res.status} (${requestErrorId}): ${details.reason}`, "classify-request-quota");
      }
      if (
        details.retryAfterMs !== null
        && details.retryAfterMs > 0
        && details.retryAfterMs <= MAX_REMOTE_429_RETRY_WAIT_MS
        && attempt < 2
      ) {
        await new Promise((r) => setTimeout(r, details.retryAfterMs!));
        continue;
      }
      if (res.status === 529 && attempt < 2) {
        // Overloaded with no usable retry-after: back off and retry rather than defer.
        await new Promise((r) => setTimeout(r, retryDelayMs(res, attempt)));
        continue;
      }
      return makeSkippedResult("quota_deferred", details.reason, {
        error_type: details.errorType ?? "rate_limit_error",
        request_error_id: requestErrorId,
        retry_after_ms: details.retryAfterMs,
      });
    }

    if (!TRANSIENT_STATUSES.has(res.status) || attempt === 2) {
      const details = await readAnthropicFailure(res);
      const requestErrorId = nextRequestErrorId();
      if (logError) await logError(`Anthropic request failed (${requestErrorId}): ${details.reason}`, "classify-request-error");
      return makeSkippedResult("classifier_error", details.reason, {
        error_type: details.errorType,
        request_error_id: requestErrorId,
        retry_after_ms: details.retryAfterMs,
      });
    }

    const waitMs = retryDelayMs(res, attempt);
    if (logError) await logError(`Anthropic HTTP ${res.status}, retrying in ${waitMs}ms (attempt ${attempt + 1}/3)`, "classify-retry");
    await new Promise((r) => setTimeout(r, waitMs));
  }

  return makeSkippedResult("classifier_error", "retry_exhausted");
}

// Single dispatch point: claude-* models go to the Anthropic native path (no
// Gemini quota gate), everything else to Gemini. Gemini keeps its single
// concatenated prompt; Anthropic gets the instruction/posts split for caching.
function callClassifier(
  instructions: string,
  postsBlock: string,
  apiKey: string,
  maxTokens: number,
  mode: "single" | "batch",
  logError?: (msg: string, ctx?: string) => Promise<void>,
  options: ClassifyOptions = {},
): Promise<Response | ClassifyResult> {
  if (providerForModel(classifierModel(options)) === "anthropic") {
    return fetchAnthropic(instructions, postsBlock, apiKey, maxTokens, mode, logError, options);
  }
  return fetchGemini(instructions + postsBlock, apiKey, maxTokens, mode, logError, options);
}

export async function classifyPost(
  text: string,
  apiKey: string,
  logError?: (msg: string, ctx?: string) => Promise<void>,
  options: ClassifyOptions = {},
): Promise<ClassifyResult> {
  const startedAt = performance.now();
  try {
    const singleTokens = options.maxTokensOverride && options.maxTokensOverride > 0 ? options.maxTokensOverride : 700;
    const res = await callClassifier(CLASSIFY_PROMPT, text.slice(0, 600), apiKey, singleTokens, "single", logError, options);
    if (!(res instanceof Response)) {
      if (logError) await logError(`AI gateway ${res.status}: ${res.error}`, "classify-error");
      return res;
    }
    const data = await res.json();
    await emitUsage(options, classifierModel(options), "single", data, startedAt);
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
  options: ClassifyOptions = {},
): Promise<ClassifyResult[]> {
  const startedAt = performance.now();
  // 4096 truncates batches that include translations: each result is ~120-300
  // tokens (more when english_translation is populated), so a full batch can
  // exceed 4096 and the JSON response cuts off mid-array. Canary harness (commit
  // 7d49112) validated 8192 for translation-heavy posts; the live drain uses
  // batchSize=20 (May-15 migration) and keeps this headroom. On Anthropic
  // max_tokens is a cap only (billed on actual output), so 8192 has no cost downside.
  const batchTokens = options.maxTokensOverride && options.maxTokensOverride > 0 ? options.maxTokensOverride : 8192;
  const res = await callClassifier(prompt, numbered, apiKey, batchTokens, "batch", logError, options);
  if (!(res instanceof Response)) {
    if (logError) await logError(`Batch classify ${res.status}: ${res.error}`, "batch-classify-error");
    return Array.from({ length: batchLength }, () => res);
  }
  const data = await res.json();
  await emitUsage(options, classifierModel(options), "batch", data, startedAt);
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
    // A short results array means the model truncated or dropped trailing posts.
    // Treat the missing tail as a retryable parse_error, NOT IRRELEVANT_RESULT —
    // padding with irrelevant writes an unclassified post to terminal `irrelevant`
    // (never retried, invisible to coverage), silently dropping it from scoring.
    results.push(j < parsedResults.length ? parseResult(parsedResults[j]) : makeSkippedResult("parse_error", "missing_result_index"));
  }
  return results;
}

function shouldStopAfterBatch(results: ClassifyResult[]): ClassifyResult | null {
  return results.find((result) => result.status === "quota_deferred") ?? null;
}

function fillRemainingFromStop(stopResult: ClassifyResult, count: number): ClassifyResult[] {
  return Array.from({ length: count }, () => ({ ...stopResult }));
}

// A pre-built batch: the numbered prompt body + how many posts it covers.
interface BatchDescriptor {
  numbered: string;
  length: number;
}

// Anthropic has no quota gate and Tier 1 Haiku (50 RPM / 100k OTPM) dwarfs our
// ~10 calls/pass, so batches run concurrently. The cap also bounds burst against
// a concurrent reclassify sharing the account; 429/529 backoff is the safety net.
const ANTHROPIC_BATCH_CONCURRENCY = Math.max(1, Number(envValue("ANTHROPIC_BATCH_CONCURRENCY", "4")));

function batchExceptionResults(length: number, e: unknown): ClassifyResult[] {
  return Array.from({ length }, () => makeSkippedResult("classifier_error", e instanceof Error ? e.message : String(e)));
}

// Anthropic path: bounded-concurrency workers, each writing its batch into the
// descriptor's POSITIONAL slot (never completion order) so results[i] stays
// aligned to rows[i] — the per-row update loop and spillover failedIdx mapping
// both depend on that. No inter-batch sleep; no Gemini-only quota early-break.
async function runBatchesConcurrent(
  prompt: string,
  descriptors: BatchDescriptor[],
  apiKey: string,
  logError?: (msg: string, ctx?: string) => Promise<void>,
  options: ClassifyOptions = {},
): Promise<ClassifyResult[]> {
  const out: ClassifyResult[][] = new Array(descriptors.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const idx = next++;
      if (idx >= descriptors.length) return;
      const d = descriptors[idx];
      try {
        out[idx] = await batchClassifyWithPrompt(prompt, d.numbered, d.length, apiKey, logError, options);
      } catch (e) {
        if (logError) await logError(`Batch classify exception: ${e instanceof Error ? e.message : String(e)}`, "batch-classify-exception");
        out[idx] = batchExceptionResults(d.length, e);
      }
    }
  };
  const lanes = Math.min(ANTHROPIC_BATCH_CONCURRENCY, descriptors.length);
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return out.flat();
}

// Gemini path: serial, with the 2s inter-batch pacing and the quota early-break
// (a quota_deferred batch fans the stop sentinel across all remaining posts).
async function runBatchesSerial(
  prompt: string,
  descriptors: BatchDescriptor[],
  totalLength: number,
  apiKey: string,
  logError?: (msg: string, ctx?: string) => Promise<void>,
  options: ClassifyOptions = {},
): Promise<ClassifyResult[]> {
  const allResults: ClassifyResult[] = [];
  let consumed = 0;
  for (const d of descriptors) {
    consumed += d.length;
    try {
      const results = await batchClassifyWithPrompt(prompt, d.numbered, d.length, apiKey, logError, options);
      allResults.push(...results);
      const stopResult = shouldStopAfterBatch(results);
      if (stopResult && consumed < totalLength) {
        allResults.push(...fillRemainingFromStop(stopResult, totalLength - consumed));
        break;
      }
      if (consumed < totalLength) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      if (logError) await logError(`Batch classify exception: ${e instanceof Error ? e.message : String(e)}`, "batch-classify-exception");
      allResults.push(...batchExceptionResults(d.length, e));
    }
  }
  return allResults;
}

function runBatches(
  prompt: string,
  descriptors: BatchDescriptor[],
  totalLength: number,
  apiKey: string,
  logError?: (msg: string, ctx?: string) => Promise<void>,
  options: ClassifyOptions = {},
): Promise<ClassifyResult[]> {
  if (descriptors.length === 0) return Promise.resolve([]);
  return providerForModel(classifierModel(options)) === "anthropic"
    ? runBatchesConcurrent(prompt, descriptors, apiKey, logError, options)
    : runBatchesSerial(prompt, descriptors, totalLength, apiKey, logError, options);
}

export async function classifyBatch(
  texts: string[],
  apiKey: string,
  batchSize = 25,
  logError?: (msg: string, ctx?: string) => Promise<void>,
  options: ClassifyOptions = {},
): Promise<ClassifyResult[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await classifyPost(texts[0], apiKey, logError, options)];

  const descriptors: BatchDescriptor[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const numbered = batch.map((t, j) => `Post ${j + 1}: "${t.slice(0, 600)}"`).join("\n\n");
    descriptors.push({ numbered, length: batch.length });
  }
  return runBatches(BATCH_CLASSIFY_PROMPT, descriptors, texts.length, apiKey, logError, options);
}

export async function classifyBatchTargeted(
  items: { text: string; targetModel: string }[],
  apiKey: string,
  batchSize = 25,
  logError?: (msg: string, ctx?: string) => Promise<void>,
  options: ClassifyOptions = {},
): Promise<ClassifyResult[]> {
  if (items.length === 0) return [];

  const descriptors: BatchDescriptor[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const numbered = batch.map((item, j) => `Post ${j + 1} [TARGET: ${item.targetModel}]: "${item.text.slice(0, 600)}"`).join("\n\n");
    descriptors.push({ numbered, length: batch.length });
  }
  return runBatches(BATCH_CLASSIFY_TARGETED_PROMPT, descriptors, items.length, apiKey, logError, options);
}
