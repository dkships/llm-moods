const VALID_SENTIMENTS = new Set(["positive", "negative", "neutral"]);

export const VALID_PUBLIC_COMPLAINTS = new Set([
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
]);

export const VALID_PRAISE_CATEGORIES = new Set([
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
]);

const COMPLAINT_ALIASES: Record<string, string> = {
  reliability: "api_reliability",
};

export function normalizeSentiment(sentiment: string | null | undefined): string | null {
  return sentiment && VALID_SENTIMENTS.has(sentiment) ? sentiment : null;
}

export function normalizeComplaintCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const normalized = COMPLAINT_ALIASES[category] || category;
  return VALID_PUBLIC_COMPLAINTS.has(normalized) ? normalized : null;
}

export function normalizePraiseCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  return VALID_PRAISE_CATEGORIES.has(category) ? category : null;
}
