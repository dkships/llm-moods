import { describe, expect, it } from "vitest";

import { isLikelyLinkShare } from "../../supabase/functions/_shared/utils";
import {
  expandRumorPlaceholder,
  rumorSearchTerms,
  type RumorRow,
} from "../../supabase/functions/_shared/search-terms";

// Measured 2026-11-17 on 14 days of labeled Bluesky posts: the rule drops 22%
// of volume and 1.8% of relevant posts (OPERATIONS-HISTORY 2026-11-17).
describe("isLikelyLinkShare", () => {
  it("flags a third-party news link with no first-person voice", () => {
    expect(isLikelyLinkShare("OpenAI disbands its robotics team as GPT-6 Astra runs robots techinnovation.cloud/no...", "")).toBe(true);
    expect(isLikelyLinkShare("Microsoft's small AI gambit could topple OpenAI https://aidailypost.com/news/123", "")).toBe(true);
  });

  it("keeps links to places people publish their own words", () => {
    expect(isLikelyLinkShare("Told to reboot a server, Codex destroyed systemd https://github.com/openai/codex/issues/5", "")).toBe(false);
    expect(isLikelyLinkShare("Seems like Claude genuinely failed really hard here. https://x.com/someone/status/1", "")).toBe(false);
    expect(isLikelyLinkShare("Claude Codeの実装のクセ https://zenn.dev/someone/articles/abc", "")).toBe(false);
  });

  it("keeps first-person experience even with a news link", () => {
    expect(isLikelyLinkShare("I switched to Claude after this https://theverge.com/ai/123", "")).toBe(false);
    expect(isLikelyLinkShare("my subscription renewed and GPT is worse https://example.com/x", "")).toBe(false);
  });

  it("ignores posts without links", () => {
    expect(isLikelyLinkShare("Opus 5.5 is great, good enough for me", "")).toBe(false);
  });
});

describe("rumorSearchTerms", () => {
  const row = (r: Partial<RumorRow>): RumorRow => ({ model_slug: "chatgpt", version_label: null, codename: null, ...r });

  it("prefers a numbered version label and pairs bare codenames with the vendor", () => {
    const terms = rumorSearchTerms([
      row({ model_slug: "grok", version_label: "Grok 4.8" }),
      row({ model_slug: "chatgpt", codename: "Aurora" }),
      row({ model_slug: "gemini", version_label: "Gemini 4 Helix", codename: "Helix" }),
    ], 6);
    expect(terms).toEqual([
      { text: "Grok 4.8", kind: "version" },
      { text: "Aurora OpenAI", kind: "codename" },
      { text: "Gemini 4 Helix", kind: "version" },
    ]);
  });

  it("skips labels too generic to search and de-duplicates", () => {
    const terms = rumorSearchTerms([
      row({ version_label: "GPT" }),
      row({ model_slug: "grok", version_label: "Grok 4.8" }),
      row({ model_slug: "grok", version_label: "grok 4.8" }),
    ], 6);
    expect(terms.map((t) => t.text)).toEqual(["Grok 4.8"]);
  });

  it("caps the list so the request budget stays bounded", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ model_slug: "grok", version_label: `Grok 9.${i}` }));
    expect(rumorSearchTerms(rows, 4)).toHaveLength(4);
  });
});

describe("expandRumorPlaceholder", () => {
  const lane = '({ACTIVE_RUMORS} OR ((leaked OR "in testing") (Claude OR OpenAI))) lang:en -filter:retweets';

  it("renders versions as phrases and codename pairs as AND groups", () => {
    const query = expandRumorPlaceholder(lane, [
      { text: "Grok 4.8", kind: "version" },
      { text: "Aurora OpenAI", kind: "codename" },
    ]);
    expect(query).toBe('(("Grok 4.8" OR (Aurora OpenAI)) OR ((leaked OR "in testing") (Claude OR OpenAI))) lang:en -filter:retweets');
  });

  it("drops the placeholder cleanly when no rumor is live", () => {
    expect(expandRumorPlaceholder(lane, [])).toBe('(((leaked OR "in testing") (Claude OR OpenAI))) lang:en -filter:retweets');
  });

  it("leaves queries without the placeholder untouched", () => {
    expect(expandRumorPlaceholder("(chatgpt) lang:en", [{ text: "Grok 4.8", kind: "version" }])).toBe("(chatgpt) lang:en");
  });
});
