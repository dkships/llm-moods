import {
  PUBLIC_COMPLAINT_CATEGORIES,
  PRAISE_CATEGORIES,
  normalizePraiseCategory as normalizeSharedPraiseCategory,
  normalizePublicComplaintCategory,
  normalizeSentiment as normalizeSharedSentiment,
} from "./public-taxonomy.ts";

export const VALID_PUBLIC_COMPLAINTS = new Set(PUBLIC_COMPLAINT_CATEGORIES);
export const VALID_PRAISE_CATEGORIES = new Set(PRAISE_CATEGORIES);

export function normalizeSentiment(sentiment: string | null | undefined): string | null {
  return normalizeSharedSentiment(sentiment);
}

export function normalizeComplaintCategory(category: string | null | undefined): string | null {
  return normalizePublicComplaintCategory(category);
}

export function normalizePraiseCategory(category: string | null | undefined): string | null {
  return normalizeSharedPraiseCategory(category);
}
