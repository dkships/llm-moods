const API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODEL = "gemini-2.5-flash-lite";

export const CLASSIFY_PROMPT = `You are classifying a social media post about AI language models (ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, etc).

STEP 1 — RELEVANCE
Is this post about a user's direct experience with an AI model's quality, output, or behavior?
- RELEVANT: "Claude keeps refusing my coding requests", "GPT-4 just hallucinated my entire bibliography", "Gemini is incredible at math now"
- NOT RELEVANT: "OpenAI raised $6B", "Sam Altman tweeted about AGI", "AI will replace jobs", "Here's a tutorial on using the ChatGPT API"

If not relevant, return {"relevant": false, "sentiment": null, "complaint_category": null, "praise_category": null, "confidence": 0.0}

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
{"relevant": true/false, "sentiment": "positive"/"negative"/"neutral"/null, "complaint_category": "<category>"/null, "praise_category": "<category>"/null, "confidence": 0.0-1.0}

Post to classify: `;

const BATCH_CLASSIFY_PROMPT = `You are classifying social media posts about AI language models (ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, etc).

For EACH post, determine:

RELEVANCE: Is this about a user's direct experience with an AI model's quality, output, or behavior?
- RELEVANT: complaints, praise, comparisons of output quality
- NOT RELEVANT: news, funding, tutorials, general AI opinions

SENTIMENT (if relevant):
- "positive": praising, impressed, satisfied
- "negative": complaining, frustrated, disappointed
- "neutral": genuinely mixed or purely factual (should be RARE)

CATEGORY (if relevant):
If negative: lazy_responses, hallucinations, refusals, coding_quality, speed, general_drop, pricing_value, censorship, context_window, api_reliability, multimodal_quality, reasoning
If positive: output_quality, coding_quality, speed, reasoning, creativity, value, reliability, context_handling, multimodal_quality, general_improvement

CONFIDENCE: 0.0-1.0 (0.9+ = explicit model name + clear sentiment, 0.7-0.8 = clear but indirect, below 0.5 = weak)

Return ONLY a JSON array with one object per post in the same order:
[{"relevant": true/false, "sentiment": "..."/null, "complaint_category": "..."/null, "praise_category": "..."/null, "confidence": 0.0-1.0}, ...]

Posts to classify:
`;

export interface ClassifyResult {
  relevant: boolean;
  sentiment: string | null;
  complaint_category: string | null;
  praise_category: string | null;
  confidence: number;
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
  };
}

export async function classifyPost(
  text: string,
  apiKey: string,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<ClassifyResult> {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: CLASSIFY_PROMPT + text.slice(0, 600) }],
      }),
    });
    if (!res.ok) {
      if (logError) await logError(`AI gateway HTTP ${res.status}`, "classify-error");
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

export async function classifyBatch(
  texts: string[],
  apiKey: string,
  batchSize = 10,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<ClassifyResult[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await classifyPost(texts[0], apiKey, logError)];

  const allResults: ClassifyResult[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const numbered = batch.map((t, j) => `Post ${j + 1}: "${t.slice(0, 600)}"`).join("\n\n");
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: BATCH_CLASSIFY_PROMPT + numbered }],
        }),
      });
      if (!res.ok) {
        if (logError) await logError(`Batch classify HTTP ${res.status}`, "batch-classify-error");
        allResults.push(...batch.map(() => SKIP_RESULT));
        continue;
      }
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || "";
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        if (logError) await logError(`Batch classify unparseable: ${raw.slice(0, 200)}`, "batch-classify-parse");
        allResults.push(...batch.map(() => SKIP_RESULT));
        continue;
      }
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        allResults.push(...batch.map(() => SKIP_RESULT));
        continue;
      }
      for (let j = 0; j < batch.length; j++) {
        allResults.push(j < parsed.length ? parseResult(parsed[j]) : SKIP_RESULT);
      }
    } catch (e) {
      if (logError) await logError(`Batch classify exception: ${e instanceof Error ? e.message : String(e)}`, "batch-classify-exception");
      allResults.push(...batch.map(() => SKIP_RESULT));
    }
  }
  return allResults;
}
