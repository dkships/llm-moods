/**
 * Allow only http(s) URLs from scraped/aggregated content; anything else
 * (javascript:, data:, malformed) renders as no link.
 */
export function getSafeExternalUrl(sourceUrl?: string | null): string | undefined {
  if (!sourceUrl) return undefined;
  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
