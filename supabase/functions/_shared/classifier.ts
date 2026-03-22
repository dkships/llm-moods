const API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODEL = "gemini-3.1-flash-lite-preview";

export const CLASSIFY_PROMPT = `You are classifying a social media post about AI language models (ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, etc).

STEP 1 — RELEVANCE
Is this post expressing an opinion about an AI model's quality, behavior, or usefulness?
- RELEVANT: direct experience, quality complaints/praise, model comparisons, switching decisions, trend observations
  Examples: "Claude keeps refusing my coding requests", "GPT-4 just hallucinated my bibliography", "Claude is way better than GPT for coding", "has anyone noticed Gemini getting worse?", "I switched from ChatGPT to Claude"
- NOT RELEVANT: pure news/funding, job market opinions, tutorials with no quality opinion, company strategy/business moves
  Examples: "OpenAI raised $6B", "Here's a tutorial on using the ChatGPT API", "AI will replace jobs", "Sam Altman tweeted about AGI"

If not relevant, return {"relevant": false, "sentiment": null, "complaint_category": null, "praise_category": null, "confidence": 0.0, "language": null, "english_translation": null}

STEP 1b — LANGUAGE
If the post is NOT in English, detect the language (ISO 639-1 code, e.g. "ja", "ko", "zh", "de", "fr", "es", "pt") and provide a concise English translation. Classify sentiment based on the translated meaning.
If the post IS in English, set "language" to null and "english_translation" to null.

STEP 2 — SENTIMENT
- "positive": Praising quality, impressed by output, favorably comparing to alternatives, expressing satisfaction
- "negative": Complaining about quality, frustrated with output, unfavorably comparing, expressing disappointment
- "neutral": Genuinely mixed or purely factual comparison with no opinion. This should be RARE — most relevant posts express clear sentiment. When ambiguous, lean toward the expressed emotion.

STEP 3 — CATEGORY
If negative, set complaint_category to one of: lazy_responses, hallucinations, refusals, coding_quality, speed, general_drop, pricing_value, censorship, context_window, api_reliability, multimodal_quality, reasoning
If positive, set praise_category to one of: output_quality, coding_quality, speed, reasoning, creativity, value, reliability, context_handling, multimodal_quality, general_improvement
If neutral, both should be null.

STEP 4 — CONFIDENCE (0.0-1.0)
- 0.9-1.0: Explicitly names a model AND has clear sentiment ("Claude 3.5 is amazing at code")
- 0.7-0.8: Clearly about a model with discernible sentiment, but less direct
- 0.5-0.6: Ambiguous — could be about this model, or sentiment is unclear
- Below 0.5: Weak signal, likely not relevant

Return ONLY valid JSON:
{"relevant": true/false, "sentiment": "positive"/"negative"/"neutral"/null, "complaint_category": "<category>"/null, "praise_category": "<category>"/null, "confidence": 0.0-1.0, "language": "<iso-code>"/null, "english_translation": "<translation>"/null}

Post to classify: `;

const BATCH_CLASSIFY_PROMPT = `You are classifying social media posts about AI language models (ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, etc).

For EACH post, determine:

RELEVANCE: Is this post expressing an opinion about an AI model's quality, behavior, or usefulness?
- RELEVANT: direct experience, quality complaints/praise, model comparisons, switching decisions, trend observations
  Examples: "Claude keeps refusing my coding requests", "GPT-4 just hallucinated my bibliography", "Claude is way better than GPT for coding", "has anyone noticed Gemini getting worse?", "I switched from ChatGPT to Claude"
- NOT RELEVANT: pure news/funding, job market opinions, tutorials with no quality opinion, company strategy/business moves
  Examples: "OpenAI raised $6B", "Here's a tutorial on using the ChatGPT API", "AI will replace jobs"

LANGUAGE: If a post is NOT in English, detect the language (ISO 639-1 code) and provide a concise English translation. Classify sentiment based on the translated meaning. If the post IS in English, set both to null.

SENTIMENT (if relevant):
- "positive": praising, impressed, satisfied
- "negative": complaining, frustrated, disappointed
- "neutral": genuinely mixed or purely factual (should be RARE)

CATEGORY (if relevant):
If negative: lazy_responses, hallucinations, refusals, coding_quality, speed, general_drop, pricing_value, censorship, context_window, api_reliability, multimodal_quality, reasoning
If positive: output_quality, coding_quality, speed, reasoning, creativity, value, reliability, context_handling, multimodal_quality, general_improvement

CONFIDENCE: 0.0-1.0 (0.9+ = explicit model name + clear sentiment, 0.7-0.8 = clear but indirect, below 0.5 = weak)

Return ONLY a JSON array with one object per post in the same order:
[{"relevant": true/false, "sentiment": "..."/null, "complaint_category": "..."/null, "praise_category": "..."/null, "confidence": 0.0-1.0, "language": "..."/null, "english_translation": "..."/null}, ...]

Posts to classify:
`;

const BATCH_CLASSIFY_TARGETED_PROMPT = `You are classifying social media posts about AI language models. Each post has a TARGET MODEL indicated in brackets. You must classify the sentiment SPECIFICALLY TOWARD that target model.

IMPORTANT: A post may mention multiple AI models. Focus ONLY on what it says about the TARGET model. For example:
- "DeepSeek just debugged a massive Stripe mess that Gemini made" → [TARGET: Gemini] = NEGATIVE (Gemini made a mess), [TARGET: DeepSeek] = POSITIVE (DeepSeek fixed it)
- "I switched from ChatGPT to Claude and it's so much better" → [TARGET: Claude] = POSITIVE, [TARGET: ChatGPT] = NEGATIVE

For EACH post, determine:

RELEVANCE: Is this post expressing an opinion about the TARGET model's quality, behavior, or usefulness? If the target model is only mentioned in passing with no opinion about it, mark as not relevant.

LANGUAGE: If a post is NOT in English, detect the language (ISO 639-1 code) and provide a concise English translation. Classify sentiment based on the translated meaning. If the post IS in English, set both to null.

SENTIMENT (if relevant, toward the TARGET model only):
- "positive": praising, impressed, satisfied with the target model
- "negative": complaining, frustrated, disappointed with the target model
- "neutral": genuinely mixed or purely factual about the target model (should be RARE)

CATEGORY (if relevant):
If negative: lazy_responses, hallucinations, refusals, coding_quality, speed, general_drop, pricing_value, censorship, context_window, api_reliability, multimodal_quality, reasoning
If positive: output_quality, coding_quality, speed, reasoning, creativity, value, reliability, context_handling, multimodal_quality, general_improvement

CONFIDENCE: 0.0-1.0 (0.9+ = explicit target model name + clear sentiment toward it, 0.7-0.8 = clear but indirect, below 0.5 = weak)

Return ONLY a JSON array with one object per post in the same order:
[{"relevant": true/false, "sentiment": "..."/null, "complaint_category": "..."/null, "praise_category": "..."/null, "confidence": 0.0-1.0, "language": "..."/null, "english_translation": "..."/null}, ...]

Posts to classify:
`;

export interface ClassifyResult {
  relevant: boolean;
  sentiment: string | null;
  complaint_category: string | null;
  praise_category: string | null;
  confidence: number;
  language?: string | null;
  english_translation?: string | null;
}

const SKIP_RESULT: ClassifyResult = {
  relevant: false,
  sentiment: null,
  complaint_category: null,
  praise_category: null,
  confidence: 0,
};

function parseResult(parsed: any): ClassifyResult {
  return {
    relevant: parsed.relevant !== false,
    sentiment: parsed.sentiment || null,
    complaint_category: parsed.complaint_category || null,
    praise_category: parsed.praise_category || null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    language: parsed.language || null,
    english_translation: parsed.english_translation || null,
  };
}

export async function classifyPost(
  text: string,
  apiKey: string,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<ClassifyResult> {
  try {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: CLASSIFY_PROMPT + text.slice(0, 600) }],
        }),
      });
      if (res.status !== 429) break;
      const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 5000;
      await new Promise(r => setTimeout(r, waitMs));
    }
    if (!res || !res.ok) {
      if (logError) await logError(`AI gateway HTTP ${res?.status ?? "no-response"}`, "classify-error");
      return SKIP_RESULT;
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      if (logError) await logError(`AI gateway returned unparseable response: ${raw.slice(0, 200)}`, "classify-parse-error");
      return SKIP_RESULT;
    }
    return parseResult(JSON.parse(jsonMatch[0]));
  } catch (e) {
    if (logError) await logError(`classifyPost exception: ${e instanceof Error ? e.message : String(e)}`, "classify-exception");
    return SKIP_RESULT;
  }
}

async function batchClassifyWithPrompt(
  prompt: string,
  numbered: string,
  batchLength: number,
  apiKey: string,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<ClassifyResult[]> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt + numbered }],
      }),
    });
    if (res.status !== 429) break;
    const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 5000;
    if (logError) await logError(`Batch classify 429, retrying in ${waitMs}ms (attempt ${attempt + 1}/3)`, "batch-classify-retry");
    await new Promise(r => setTimeout(r, waitMs));
  }
  if (!res || !res.ok) {
    if (logError) await logError(`Batch classify HTTP ${res?.status ?? "no-response"}`, "batch-classify-error");
    return Array(batchLength).fill(SKIP_RESULT);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    if (logError) await logError(`Batch classify unparseable: ${raw.slice(0, 200)}`, "batch-classify-parse");
    return Array(batchLength).fill(SKIP_RESULT);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) {
    return Array(batchLength).fill(SKIP_RESULT);
  }
  const results: ClassifyResult[] = [];
  for (let j = 0; j < batchLength; j++) {
    results.push(j < parsed.length ? parseResult(parsed[j]) : SKIP_RESULT);
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
      allResults.push(...batch.map(() => SKIP_RESULT));
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
      allResults.push(...batch.map(() => SKIP_RESULT));
    }
  }
  return allResults;
}
