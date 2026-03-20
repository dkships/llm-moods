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

export async function classifyPost(
  text: string,
  apiKey: string,
  logError?: (msg: string, ctx?: string) => Promise<void>,
): Promise<ClassifyResult> {
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash-lite",
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
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      relevant: parsed.relevant !== false,
      sentiment: parsed.sentiment || null,
      complaint_category: parsed.complaint_category || null,
      praise_category: parsed.praise_category || null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch (e) {
    if (logError) await logError(`classifyPost exception: ${e instanceof Error ? e.message : String(e)}`, "classify-exception");
    return SKIP_RESULT;
  }
}
