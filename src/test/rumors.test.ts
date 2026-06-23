import { describe, expect, it } from "vitest";

import { isLikelyRumorCandidate } from "../../supabase/functions/_shared/rumor-detect";
import {
  buildContribution,
  groupByCluster,
  mergeCluster,
  normalizeVersionKey,
  parseRecordRumors,
  type RawClaim,
  type RumorContribution,
  type RumorRow,
  type SourceRef,
} from "../../supabase/functions/_shared/rumor-rollup";

function src(url: string, platform: string, posted_at: string, score = 0): SourceRef {
  return { url, platform, posted_at, score, handle: null, snippet: "s" };
}

function contrib(over: Partial<RumorContribution> & { source: SourceRef }): RumorContribution {
  return {
    modelSlug: "claude",
    versionKey: "sonnet5",
    versionLabel: "Sonnet 5",
    codename: null,
    claimType: "launch",
    claimSummary: "summary",
    rumoredBenefit: null,
    signals: null,
    etaText: null,
    etaDate: null,
    confidence: 0.8,
    ...over,
  };
}

describe("isLikelyRumorCandidate", () => {
  it("matches leak / stage / timing / return chatter", () => {
    for (const t of [
      "Sonnet 5 incoming",
      "GPT-5.6 has been delayed to mid-July",
      "Claude Sonnet 5 spotted in the API",
      "Gemini 4 scheduled next week",
      "Fable 5 is returning soon",
      "model string for opus 5 leaked",
      "EAP access just opened",
      "that output is looking sus",
    ]) {
      expect(isLikelyRumorCandidate(t, "")).toBe(true);
    }
  });

  it("does not match ordinary sentiment", () => {
    for (const t of ["I love using Claude for coding", "ChatGPT keeps making mistakes today"]) {
      expect(isLikelyRumorCandidate(t, "")).toBe(false);
    }
  });

  it("word-bounds short tokens to avoid substring false positives", () => {
    expect(isLikelyRumorCandidate("versus the other model", "")).toBe(false); // not "sus"
    expect(isLikelyRumorCandidate("the census numbers", "")).toBe(false); // not "sus"
    expect(isLikelyRumorCandidate("this plan is cheap", "")).toBe(false); // not "EAP"
  });

  it("checks title and body together", () => {
    expect(isLikelyRumorCandidate("Claude update", "rumored to drop next week")).toBe(true);
    expect(isLikelyRumorCandidate(null, null)).toBe(false);
  });
});

describe("normalizeVersionKey", () => {
  it("normalizes label or codename to an alphanumeric key", () => {
    expect(normalizeVersionKey("Sonnet 5", null)).toBe("sonnet5");
    expect(normalizeVersionKey("GPT-5.6", null)).toBe("gpt56");
    expect(normalizeVersionKey(null, "Fennec")).toBe("fennec");
  });

  it("returns null when there is nothing usable", () => {
    expect(normalizeVersionKey(null, null)).toBeNull();
    expect(normalizeVersionKey("", "")).toBeNull();
    expect(normalizeVersionKey("!", null)).toBeNull();
  });
});

describe("buildContribution", () => {
  const source = src("u1", "reddit", "2026-06-22", 3);

  it("accepts a valid unreleased claim and maps fields", () => {
    const raw: RawClaim = {
      is_rumor: true,
      target_family: "claude",
      version_label: "Sonnet 5",
      is_unreleased: true,
      claim_type: "in_testing",
      claim_summary: "Available to select enterprise customers under EAP.",
      confidence: 0.7,
    };
    const c = buildContribution(raw, source, "Claude Sonnet 5 is in early access for enterprise");
    expect(c).not.toBeNull();
    expect(c!.modelSlug).toBe("claude");
    expect(c!.versionKey).toBe("sonnet5");
    expect(c!.claimType).toBe("in_testing");
  });

  it("drops non-rumors, released versions, and unknown family", () => {
    const base: RawClaim = { is_rumor: true, target_family: "claude", version_label: "Sonnet 5", is_unreleased: true };
    expect(buildContribution({ ...base, is_rumor: false }, source, "Sonnet 5")).toBeNull();
    expect(buildContribution({ ...base, is_unreleased: false }, source, "Sonnet 5")).toBeNull();
    expect(buildContribution({ ...base, target_family: "unknown" }, source, "Sonnet 5")).toBeNull();
  });

  it("drops a claim with no version or codename", () => {
    const raw: RawClaim = { is_rumor: true, target_family: "gemini", is_unreleased: true };
    expect(buildContribution(raw, source, "something about gemini")).toBeNull();
  });

  it("anti-hallucination: drops a version_label not present in the post text", () => {
    const raw: RawClaim = { is_rumor: true, target_family: "claude", version_label: "Sonnet 5", is_unreleased: true };
    expect(buildContribution(raw, source, "just talking about claude in general")).toBeNull();
  });

  it("accepts a codename-only claim without the substring check", () => {
    const raw: RawClaim = { is_rumor: true, target_family: "gemini", codename: "Orionmist", is_unreleased: true };
    const c = buildContribution(raw, source, "Orionmist topping the arena");
    expect(c?.versionKey).toBe("orionmist");
  });
});

describe("parseRecordRumors", () => {
  it("maps claims back to input indexes and leaves gaps empty", () => {
    const input = { posts: [{ index: 0, claims: [{ is_rumor: true }] }, { index: 2, claims: [] }] };
    const out = parseRecordRumors(input, 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(1);
    expect(out[1]).toEqual([]); // model omitted index 1 → empty, not padded
    expect(out[2]).toEqual([]);
  });

  it("ignores out-of-range indexes and malformed input", () => {
    expect(parseRecordRumors({ posts: [{ index: 9, claims: [{}] }] }, 2)).toEqual([[], []]);
    expect(parseRecordRumors(null, 2)).toEqual([[], []]);
    expect(parseRecordRumors({}, 1)).toEqual([[]]);
  });
});

describe("mergeCluster", () => {
  it("creates a fresh cluster: distinct-url count, platform union, sticky claim_type, eta conflict", () => {
    const contributions = [
      contrib({ source: src("u1", "reddit", "2026-06-20", 10), claimType: "launch", etaText: "next week" }),
      contrib({ source: src("u2", "twitter", "2026-06-22", 5), claimType: "delayed", etaText: "mid-July", claimSummary: "newest" }),
    ];
    const row = mergeCluster(null, contributions, 4);
    expect(row.mention_count).toBe(2);
    expect(new Set(row.platforms)).toEqual(new Set(["reddit", "twitter"]));
    expect(row.claim_type).toBe("delayed"); // precedence over launch
    expect(row.eta_conflicting).toBe(true); // two distinct eta phrases
    expect(row.claim_summary).toBe("newest"); // newest post by posted_at
    expect(row.eta_text).toBe("mid-July");
    expect(row.first_seen_at).toBe("2026-06-20");
    expect(row.last_seen_at).toBe("2026-06-22");
  });

  it("counts the same source_url once (a multi-model scoop can't self-corroborate)", () => {
    const dup = [
      contrib({ source: src("same-url", "twitter", "2026-06-22", 9) }),
      contrib({ source: src("same-url", "twitter", "2026-06-22", 9) }),
    ];
    expect(mergeCluster(null, dup, 4).mention_count).toBe(1);
  });

  it("accumulates into an existing row by distinct new urls and unions platforms", () => {
    const existing: RumorRow = {
      model_slug: "claude",
      version_key: "sonnet5",
      version_label: "Sonnet 5",
      codename: null,
      claim_type: "in_testing",
      claim_summary: "old",
      rumored_benefit: null,
      benefit_verified: false,
      signals: null,
      eta_text: "mid-July",
      eta_date: null,
      eta_conflicting: false,
      mention_count: 2,
      platforms: ["reddit"],
      representative_sources: [],
      first_seen_at: "2026-06-20",
      last_seen_at: "2026-06-22",
    };
    const row = mergeCluster(
      existing,
      [contrib({ source: src("u3", "hackernews", "2026-06-23", 1), claimType: "imminent", etaText: "this week", claimSummary: "new" })],
      4,
    );
    expect(row.mention_count).toBe(3); // 2 + 1 new url
    expect(new Set(row.platforms)).toEqual(new Set(["reddit", "hackernews"]));
    expect(row.claim_type).toBe("imminent"); // imminent outranks in_testing
    expect(row.claim_summary).toBe("new"); // newer post updates current state
    expect(row.eta_text).toBe("this week");
    expect(row.eta_conflicting).toBe(true); // changed from mid-July
    expect(row.last_seen_at).toBe("2026-06-23");
  });

  it("caps representative_sources to the top N by score", () => {
    const many = [10, 40, 20, 5, 30].map((s, i) => contrib({ source: src(`u${i}`, "reddit", "2026-06-22", s) }));
    const row = mergeCluster(null, many, 2);
    expect(row.representative_sources).toHaveLength(2);
    expect(row.representative_sources.map((r) => r.score)).toEqual([40, 30]);
  });
});

describe("groupByCluster", () => {
  it("groups contributions by (model_slug, version_key)", () => {
    const groups = groupByCluster([
      contrib({ source: src("a", "reddit", "2026-06-22") }),
      contrib({ source: src("b", "twitter", "2026-06-22") }),
      contrib({ modelSlug: "gemini", versionKey: "orionmist", source: src("c", "reddit", "2026-06-22") }),
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get("claude:sonnet5")).toHaveLength(2);
    expect(groups.get("gemini:orionmist")).toHaveLength(1);
  });
});
