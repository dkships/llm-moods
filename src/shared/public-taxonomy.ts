export const VALID_SENTIMENTS = ["positive", "negative", "neutral"] as const;

export const PUBLIC_COMPLAINT_CATEGORIES = [
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
] as const;

export const PRAISE_CATEGORIES = [
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
] as const;

export type NormalizedSentiment = (typeof VALID_SENTIMENTS)[number];
export type PublicComplaintCategory = (typeof PUBLIC_COMPLAINT_CATEGORIES)[number];
export type PraiseCategory = (typeof PRAISE_CATEGORIES)[number];

export const PUBLIC_COMPLAINT_LABELS: Record<PublicComplaintCategory, string> = {
  lazy_responses: "Lazy responses",
  hallucinations: "Hallucinations",
  refusals: "Refusals",
  coding_quality: "Coding quality",
  speed: "Speed",
  general_drop: "General drop",
  pricing_value: "Pricing / value",
  censorship: "Censorship",
  context_window: "Context window",
  api_reliability: "API reliability",
  multimodal_quality: "Multimodal quality",
  reasoning: "Reasoning",
  other: "Other",
};

const PUBLIC_COMPLAINT_ALIASES: Record<string, PublicComplaintCategory> = {
  reliability: "api_reliability",
};

const sentimentSet = new Set<string>(VALID_SENTIMENTS);
const complaintSet = new Set<string>(PUBLIC_COMPLAINT_CATEGORIES);
const praiseSet = new Set<string>(PRAISE_CATEGORIES);

export function normalizeSentiment(sentiment: string | null | undefined): NormalizedSentiment | null {
  if (!sentiment || !sentimentSet.has(sentiment)) {
    return null;
  }

  return sentiment as NormalizedSentiment;
}

export function normalizePublicComplaintCategory(category: string | null | undefined): PublicComplaintCategory | null {
  if (!category) {
    return null;
  }

  const normalized = PUBLIC_COMPLAINT_ALIASES[category] ?? category;

  if (!complaintSet.has(normalized)) {
    return null;
  }

  return normalized as PublicComplaintCategory;
}

export function normalizePraiseCategory(category: string | null | undefined): PraiseCategory | null {
  if (!category || !praiseSet.has(category)) {
    return null;
  }

  return category as PraiseCategory;
}

export function getPublicComplaintLabel(category: string | null | undefined): string {
  const normalized = normalizePublicComplaintCategory(category);

  if (!normalized) {
    return "Other";
  }

  return PUBLIC_COMPLAINT_LABELS[normalized];
}
