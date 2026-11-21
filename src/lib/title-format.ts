const NO_BREAK_HYPHEN = "‑";

/**
 * Keeps model names such as "GPT-6.2" on one line in display headings by
 * swapping the hyphen between a letter and a digit for a non-breaking one.
 * Display only: metadata, links and feeds keep the plain title.
 */
export function keepModelNamesWhole(title: string): string {
  return title.replace(/(?<=[A-Za-z])-(?=\d)/g, NO_BREAK_HYPHEN);
}
