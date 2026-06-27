import { describe, expect, it } from "vitest";

import { formatRumorEta } from "../lib/rumor-eta";
import { isLikelyRumorCandidate } from "../../supabase/functions/_shared/rumor-detect";
import {
  buildContribution,
  collapseQuoteEchoes,
  groupByCluster,
  isCredibleSource,
  mergeCluster,
  normalizeVersionKey,
  parseRecordRumors,
  recoverDeterministicClaims,
  referencedStatusIdFromText,
  statusIdFromUrl,
  type RawClaim,
  type RumorContribution,
  type RumorRow,
  type SourceRef,
} from "../../supabase/functions/_shared/rumor-rollup";
import {
  canonicalVersionKey,
  inferSourceQuality,
  isFamilyConsistentLabel,
  isNonFrontierLabel,
  mergeRumorRows,
  sourceQualityLabel,
  splitCompoundLabel,
  type MergeableRumor,
} from "../../supabase/functions/_shared/rumor-canon";

function src(url: string, platform: string, posted_at: string, score = 0, extra: Partial<SourceRef> = {}): SourceRef {
  return { url, platform, posted_at, score, handle: null, snippet: "s", ...extra };
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
      "Exclusive GPT-5.6 scoop: ETA for wider launch is the 2nd week of July",
      "GPT-5.6 launched for OpenAI enterprise partners for testing ahead of the wider launch",
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
    expect(isLikelyRumorCandidate("metadata export shipped", "")).toBe(false); // not "ETA"
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

  it("accepts a punctuation-variant label (post 'GPT-5,6' → label 'GPT-5.6')", () => {
    const raw: RawClaim = { is_rumor: true, target_family: "chatgpt", version_label: "GPT-5.6", is_unreleased: true };
    const c = buildContribution(raw, source, "GPT-5,6 dropping next week per a leaker");
    expect(c).not.toBeNull();
    expect(c!.modelSlug).toBe("chatgpt");
  });

  it("drops a competitor label mis-attributed to a tracked family", () => {
    const raw: RawClaim = { is_rumor: true, target_family: "gemini", version_label: "DeepSeek V3", is_unreleased: true };
    expect(buildContribution(raw, source, "DeepSeek V3 is coming soon")).toBeNull();
  });

  it("canonicalizes Claude codename aliases to one version key", () => {
    const mythos = buildContribution(
      { is_rumor: true, target_family: "claude", codename: "Mythos", is_unreleased: true },
      source,
      "Mythos spotted in the API",
    );
    const fable = buildContribution(
      { is_rumor: true, target_family: "claude", codename: "Fable 5", is_unreleased: true },
      source,
      "Fable 5 returning soon",
    );
    expect(mythos?.versionKey).toBe("fable5");
    expect(fable?.versionKey).toBe("fable5");
    expect(mythos?.versionLabel).toBe("Fable 5");
  });

  it("drops status-only Fable/Mythos news but keeps return or timing claims", () => {
    const statusOnly = buildContribution(
      {
        is_rumor: true,
        target_family: "claude",
        codename: "Mythos",
        is_unreleased: true,
        claim_type: "other",
        claim_summary: "Anthropic published a public Mythos model page.",
        confidence: 0.7,
      },
      source,
      "Anthropic published a public Mythos model page with general status details.",
    );
    expect(statusOnly).toBeNull();

    const returning = buildContribution(
      {
        is_rumor: true,
        target_family: "claude",
        codename: "Mythos",
        is_unreleased: true,
        claim_type: "return",
        claim_summary: "Mythos is rumored to return in mid-July.",
        eta_text: "mid-July",
        confidence: 0.8,
      },
      source,
      "Mythos is rumored to return in mid-July.",
    );
    expect(returning?.versionKey).toBe("fable5");
    expect(returning?.claimType).toBe("return");
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
      has_credible_source: false,
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

  it("lets a newer tracked-leaker delay supersede an older launch ETA", () => {
    const existing: RumorRow = {
      model_slug: "chatgpt",
      version_key: "gpt56",
      version_label: "GPT-5.6",
      codename: null,
      claim_type: "launch",
      claim_summary: "GPT-5.6 was expected next week.",
      rumored_benefit: null,
      benefit_verified: false,
      signals: null,
      eta_text: "next week",
      eta_date: null,
      eta_conflicting: false,
      mention_count: 2,
      platforms: ["reddit", "twitter"],
      representative_sources: [src("old-url", "reddit", "2026-06-22", 20)],
      has_credible_source: false,
      first_seen_at: "2026-06-21",
      last_seen_at: "2026-06-22",
    };
    const row = mergeCluster(
      existing,
      [
        contrib({
          modelSlug: "chatgpt",
          versionKey: "gpt56",
          versionLabel: "GPT-5.6",
          claimType: "delayed",
          claimSummary: "GPT-5.6 is delayed to mid-July.",
          etaText: "mid-July",
          source: src("https://x.com/synthwavedd/status/56", "twitter", "2026-06-23", 7, {
            handle: "synthwavedd",
          }),
        }),
      ],
      4,
    );

    expect(row.claim_type).toBe("delayed");
    expect(row.claim_summary).toBe("GPT-5.6 is delayed to mid-July.");
    expect(row.eta_text).toBe("mid-July");
    expect(row.eta_conflicting).toBe(true);
    expect(row.representative_sources[0].handle).toBe("synthwavedd");
    expect(row.representative_sources[0].source_quality).toBe("tracked_leaker");
  });

  it("caps representative_sources to the top N by score", () => {
    const many = [10, 40, 20, 5, 30].map((s, i) => contrib({ source: src(`u${i}`, "reddit", "2026-06-22", s) }));
    const row = mergeCluster(null, many, 2);
    expect(row.representative_sources).toHaveLength(2);
    expect(row.representative_sources.map((r) => r.score)).toEqual([40, 30]);
  });
});

describe("credibility", () => {
  it("flags tracked leakers, press scoops, verified high-follower accounts, artifacts, and high-engagement sources", () => {
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { handle: "synthwavedd" }))).toBe(true);
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { handle: "@SynthWaveDD" }))).toBe(true); // normalized
    expect(isCredibleSource(src("https://x.com/axios/status/1", "twitter", "2026-06-22", 0, { handle: "@axios" }))).toBe(true);
    expect(isCredibleSource(src("https://x.com/someone/status/2", "twitter", "2026-06-22", 0, { quotedStatusId: "1" }))).toBe(false);
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { verified: true }))).toBe(false);
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { verified: true, followers: 50000 }))).toBe(true);
    expect(isCredibleSource(src("u", "reddit", "2026-06-22", 500))).toBe(true); // high upvotes
    expect(isCredibleSource(src("https://www.testingcatalog.com/openai-app-string-leak/", "web", "2026-06-22", 0))).toBe(true);
    expect(isCredibleSource(src("u", "bluesky", "2026-06-22", 2))).toBe(false);
  });

  it("orders a tracked-leaker source ahead of a higher-upvote Reddit post", () => {
    const row = mergeCluster(
      null,
      [
        contrib({ source: src("reddit-url", "reddit", "2026-06-20", 900) }),
        contrib({ source: src("x-url", "twitter", "2026-06-21", 4, { handle: "synthwavedd", verified: true }) }),
      ],
      4,
    );
    expect(row.representative_sources[0].url).toBe("x-url"); // leaker leads despite lower score
    expect(row.representative_sources[0].source_quality).toBe("tracked_leaker");
    expect(row.has_credible_source).toBe(true);
  });

  it("orders tracked leakers ahead of press scoops, and press scoops ahead of unknown posts", () => {
    const row = mergeCluster(
      null,
      [
        contrib({ source: src("reddit-url", "reddit", "2026-06-20", 900) }),
        contrib({ source: src("axios-url", "twitter", "2026-06-21", 2, { handle: "axios" }) }),
        contrib({ source: src("x-url", "twitter", "2026-06-22", 1, { handle: "synthwavedd" }) }),
      ],
      4,
    );
    expect(row.representative_sources.map((s) => s.url)).toEqual(["x-url", "axios-url", "reddit-url"]);
    expect(row.representative_sources.map((s) => s.source_quality)).toEqual([
      "tracked_leaker",
      "press_scoop",
      "unknown",
    ]);
  });

  it("marks a single credible source so it can pass the gate, but not a lone low-signal post", () => {
    const credible = mergeCluster(null, [contrib({ source: src("x", "twitter", "2026-06-22", 1, { handle: "synthwavedd" }) })], 4);
    expect(credible.mention_count).toBe(1);
    expect(credible.has_credible_source).toBe(true);

    const scoop = mergeCluster(null, [contrib({ source: src("https://www.axios.com/fable-5", "web", "2026-06-22", 0) })], 4);
    expect(scoop.mention_count).toBe(1);
    expect(scoop.has_credible_source).toBe(true);

    const weak = mergeCluster(null, [contrib({ source: src("b", "bluesky", "2026-06-22", 1) })], 4);
    expect(weak.has_credible_source).toBe(false);
  });
});

describe("source quality", () => {
  it("classifies tracked leakers, official pages, prediction markets, artifacts, and echoes", () => {
    expect(inferSourceQuality({ url: "https://x.com/SynthWaveDD/status/1", platform: "twitter", handle: "@SynthWaveDD" })).toBe(
      "tracked_leaker",
    );
    expect(inferSourceQuality({ url: "https://platform.openai.com/docs/models", platform: "web" })).toBe("official");
    expect(inferSourceQuality({ url: "https://polymarket.com/event/gpt-5-6", platform: "web" })).toBe(
      "prediction_market",
    );
    expect(inferSourceQuality({ url: "https://www.testingcatalog.com/openai-app-string-leak/", platform: "web" })).toBe(
      "artifact_leak",
    );
    expect(inferSourceQuality({ url: "https://x.com/axios/status/1", platform: "twitter", handle: "@axios" })).toBe(
      "press_scoop",
    );
    expect(inferSourceQuality({ url: "https://www.axios.com/2026/06/27/fable-5", platform: "web" })).toBe(
      "press_scoop",
    );
    expect(inferSourceQuality({ url: "https://x.com/someone/status/2", platform: "twitter", quotedStatusId: "1" })).toBe(
      "press_echo",
    );
    expect(sourceQualityLabel("prediction_market")).toBe("prediction market signal");
    expect(sourceQualityLabel("press_scoop")).toBe("reported scoop");
  });
});

describe("deterministic rumor recovery", () => {
  it("recovers obvious GPT-5.6 delay and Gemini 3.5 Pro claims from a tracked source", () => {
    const source = src("https://x.com/synthwavedd/status/2069432791184650426", "twitter", "2026-06-24", 4, {
      handle: "synthwavedd",
    });
    const text = [
      "June delays:",
      "GPT-5.6 delayed to mid-July.",
      "3.5 Pro is in testing with limited access.",
    ].join("\n");

    const claims = recoverDeterministicClaims(source, text);
    expect(claims).toHaveLength(2);

    const contributions = claims
      .map((raw) => buildContribution(raw, source, text))
      .filter(Boolean) as RumorContribution[];
    expect(contributions.map((c) => `${c.modelSlug}:${c.versionKey}:${c.claimType}`)).toEqual([
      "chatgpt:gpt56:delayed",
      "gemini:gemini35pro:in_testing",
    ]);
    expect(contributions[0].etaText).toBe("mid-July");
    expect(contributions[1].versionLabel).toBe("Gemini 3.5 Pro");
  });

  it("does not recover from low-signal uncorroborated posts", () => {
    const weakSource = src("u", "bluesky", "2026-06-24", 1);
    expect(recoverDeterministicClaims(weakSource, "GPT-5.6 delayed to mid-July. 3.5 Pro in testing.")).toEqual([]);
  });

  it("recovers GPT-5.6 enterprise partner testing with a wider-launch ETA from a tracked source", () => {
    const source = src("https://x.com/synthwavedd/status/207123", "twitter", "2026-06-25", 1300, {
      handle: "synthwavedd",
    });
    const text = [
      "Exclusive GPT-5.6 scoop:",
      "- Today 5.6 launched for OpenAI enterprise partners for testing ahead of the wider launch",
      "- ETA for wider launch is the 2nd week of July",
      "- There will be NO pricing changes",
    ].join("\n");

    const claims = recoverDeterministicClaims(source, text);
    expect(claims).toHaveLength(1);

    const contribution = buildContribution(claims[0], source, text);
    expect(contribution?.modelSlug).toBe("chatgpt");
    expect(contribution?.versionKey).toBe("gpt56");
    expect(contribution?.claimType).toBe("in_testing");
    expect(contribution?.etaText).toBe("2nd week of July");
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

describe("statusIdFromUrl / collapseQuoteEchoes", () => {
  it("extracts the tweet status id from a url", () => {
    expect(statusIdFromUrl("https://x.com/synthwavedd/status/12345")).toBe("12345");
    expect(statusIdFromUrl("https://reddit.com/r/x/comments/abc")).toBeNull();
    expect(statusIdFromUrl(null)).toBeNull();
  });

  it("extracts a referenced X status id from repost text", () => {
    expect(referencedStatusIdFromText("mirror of https://x.com/synthwavedd/status/12345")).toBe("12345");
    expect(referencedStatusIdFromText("self https://x.com/synthwavedd/status/12345", "https://x.com/me/status/12345")).toBeNull();
    expect(referencedStatusIdFromText("nothing here")).toBeNull();
  });

  it("drops a quote-tweet echoing another tweet in the same cluster", () => {
    const original = contrib({
      source: src("https://x.com/synthwavedd/status/100", "twitter", "2026-06-23", 5, { handle: "synthwavedd" }),
    });
    const echo = contrib({
      source: src("https://x.com/buildwithhassan/status/200", "twitter", "2026-06-23", 1, {
        handle: "buildwithhassan",
        quotedStatusId: "100",
      }),
    });
    const out = collapseQuoteEchoes([original, echo]);
    expect(out).toHaveLength(1);
    expect(out[0].source.url).toContain("synthwavedd");
  });

  it("drops a cross-platform repost that links the original X status", () => {
    const original = contrib({
      source: src("https://x.com/synthwavedd/status/100", "twitter", "2026-06-23", 5, { handle: "synthwavedd" }),
    });
    const linkedEcho = contrib({
      source: src("https://www.reddit.com/r/singularity/comments/abc", "reddit", "2026-06-23", 200, {
        quotedStatusId: referencedStatusIdFromText("original: https://x.com/synthwavedd/status/100"),
      }),
    });
    const out = collapseQuoteEchoes([original, linkedEcho]);
    expect(out).toHaveLength(1);
    expect(out[0].source.platform).toBe("twitter");
  });

  it("keeps a quote whose original wasn't scraped", () => {
    const echo = contrib({
      source: src("https://x.com/buildwithhassan/status/200", "twitter", "2026-06-23", 1, { quotedStatusId: "999" }),
    });
    expect(collapseQuoteEchoes([echo])).toHaveLength(1);
  });
});

describe("splitCompoundLabel", () => {
  it("splits compound labels and distributes a trailing version number", () => {
    expect(splitCompoundLabel("Fable/Mythos 5")).toEqual(["Fable 5", "Mythos 5"]);
    expect(splitCompoundLabel("Mythos/Fable 5")).toEqual(["Mythos 5", "Fable 5"]);
    expect(splitCompoundLabel("Sonnet 5 or Opus 5")).toEqual(["Sonnet 5", "Opus 5"]);
  });

  it("leaves a plain label intact and returns [] for empty", () => {
    expect(splitCompoundLabel("GPT-5.6")).toEqual(["GPT-5.6"]);
    expect(splitCompoundLabel(null)).toEqual([]);
    expect(splitCompoundLabel("")).toEqual([]);
  });
});

describe("canonicalVersionKey", () => {
  it("collapses every Fable/Mythos spelling to one canonical identity", () => {
    for (const [label, codename] of [
      [null, "Fable"],
      [null, "Mythos"],
      ["Fable 5", null],
      [null, "Mythos/Fable 5"],
      [null, "Fable/Mythos 5"],
    ] as [string | null, string | null][]) {
      const c = canonicalVersionKey("claude", label, codename);
      expect(c.key).toBe("fable5");
      expect(c.label).toBe("Fable 5");
      expect(c.codename).toBe("Mythos");
    }
  });

  it("collapses every Bidi/GPT Bidi spelling to one canonical identity", () => {
    for (const [label, codename] of [
      [null, "Bidi"],
      [null, "GPT-BIDI"],
      ["GPT Bidi 1", null],
      ["Bidi", null],
    ] as [string | null, string | null][]) {
      const c = canonicalVersionKey("chatgpt", label, codename);
      expect(c.key).toBe("bidi");
      expect(c.label).toBe("GPT Bidi 1");
      expect(c.codename).toBe("Bidi");
    }
  });

  it("collapses Gemini 3.5 Pro spelling variants to one canonical identity", () => {
    for (const label of ["3.5 Pro", "Gemini 3.5 Pro", "Gemini-3.5-Pro"]) {
      const c = canonicalVersionKey("gemini", label, null);
      expect(c.key).toBe("gemini35pro");
      expect(c.label).toBe("Gemini 3.5 Pro");
      expect(c.codename).toBeNull();
    }
  });

  it("keeps a distinct real version separate", () => {
    expect(canonicalVersionKey("claude", "Sonnet 5", null).key).toBe("sonnet5");
  });

  it("preserves a novel codename via fallback (radar still surfaces new leaks)", () => {
    const c = canonicalVersionKey("gemini", null, "Fennec");
    expect(c.key).toBe("fennec");
    expect(c.codename).toBe("Fennec");
    expect(c.label).toBeNull();
  });
});

describe("isFamilyConsistentLabel / isNonFrontierLabel", () => {
  it("accepts family-consistent labels and bare versions", () => {
    expect(isFamilyConsistentLabel("chatgpt", "GPT-5.6")).toBe(true);
    expect(isFamilyConsistentLabel("claude", "Mythos")).toBe(true);
    expect(isFamilyConsistentLabel("grok", "5")).toBe(true);
    expect(isNonFrontierLabel("claude", "Sonnet 5", null)).toBe(false);
    expect(isNonFrontierLabel("chatgpt", "GPT-5.6", null)).toBe(false);
  });

  it("keeps codename-only claims open (permissive discovery)", () => {
    expect(isNonFrontierLabel("claude", null, "Mythos")).toBe(false);
    expect(isNonFrontierLabel("gemini", null, "Orionmist")).toBe(false);
  });

  it("drops competitor names and non-family labels", () => {
    expect(isNonFrontierLabel("gemini", "DeepSeek V3", null)).toBe(true); // competitor
    expect(isNonFrontierLabel("chatgpt", "Qwen 3", null)).toBe(true); // competitor substring
    expect(isNonFrontierLabel("claude", "Badoo", null)).toBe(true); // not family-consistent
  });
});

describe("mergeRumorRows", () => {
  function rrow(over: Partial<MergeableRumor> & Record<string, unknown>): MergeableRumor {
    return {
      model_slug: "claude",
      version_label: null,
      codename: null,
      claim_type: "other",
      claim_summary: "summary",
      mention_count: 1,
      platform_count: 1,
      representative_sources: [],
      last_seen_at: "2026-06-23",
      ...over,
    } as MergeableRumor;
  }

  it("collapses alias-duplicate rows into one card with summed distinct mentions", () => {
    const out = mergeRumorRows([
      rrow({ codename: "Fable", mention_count: 1, last_seen_at: "2026-06-22",
        representative_sources: [{ url: "u1", platform: "twitter" }] }),
      rrow({ codename: "Mythos", mention_count: 1, last_seen_at: "2026-06-23",
        representative_sources: [{ url: "u2", platform: "reddit" }] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].version_label).toBe("Fable 5");
    expect(out[0].codename).toBe("Mythos");
    expect(out[0].mention_count).toBe(2); // single-unconfirmed-source tag now clears
    expect(out[0].platform_count).toBe(2);
  });

  it("collapses Bidi alias rows and preserves the newest stated ETA", () => {
    const out = mergeRumorRows([
      rrow({
        model_slug: "chatgpt",
        codename: "Bidi",
        claim_type: "imminent",
        eta_text: "this week",
        eta_conflicting: true,
        mention_count: 2,
        last_seen_at: "2026-06-23",
        representative_sources: [
          { url: "x", platform: "twitter" },
          { url: "r", platform: "reddit" },
        ],
      }),
      rrow({
        model_slug: "chatgpt",
        codename: "GPT Bidi 1",
        claim_type: "in_testing",
        mention_count: 1,
        last_seen_at: "2026-06-24",
        representative_sources: [{ url: "t", platform: "twitter" }],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].version_label).toBe("GPT Bidi 1");
    expect(out[0].codename).toBe("Bidi");
    expect(out[0].claim_type).toBe("imminent");
    expect((out[0] as { eta_text?: string | null }).eta_text).toBe("this week");
    expect((out[0] as { eta_conflicting?: boolean }).eta_conflicting).toBe(true);
    expect(out[0].mention_count).toBe(3);
  });

  it("collapses Gemini 3.5 Pro display rows into one canonical card", () => {
    const out = mergeRumorRows([
      rrow({
        model_slug: "gemini",
        version_label: "3.5 Pro",
        mention_count: 1,
        representative_sources: [{ url: "a", platform: "twitter" }],
      }),
      rrow({
        model_slug: "gemini",
        version_label: "Gemini 3.5 Pro",
        mention_count: 1,
        representative_sources: [{ url: "b", platform: "reddit" }],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].version_label).toBe("Gemini 3.5 Pro");
    expect(out[0].mention_count).toBe(2);
    expect(out[0].platform_count).toBe(2);
  });

  it("counts a url shared across two alias rows only once (no double-count)", () => {
    const out = mergeRumorRows([
      rrow({ codename: "Fable", representative_sources: [{ url: "shared", platform: "twitter" }] }),
      rrow({ codename: "Mythos", representative_sources: [{ url: "shared", platform: "twitter" }] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].mention_count).toBe(1);
  });

  it("applies claim_type precedence and takes display fields from the strongest row", () => {
    const out = mergeRumorRows([
      rrow({ codename: "Fable", claim_type: "launch", claim_summary: "old", last_seen_at: "2026-06-20",
        representative_sources: [{ url: "a", platform: "reddit" }] }),
      rrow({ codename: "Mythos", claim_type: "delayed", claim_summary: "newest", last_seen_at: "2026-06-24",
        representative_sources: [{ url: "b", platform: "twitter" }] }),
    ]);
    expect(out[0].claim_type).toBe("delayed");
    expect(out[0].claim_summary).toBe("newest");
  });

  it("replaces stale GPT-5.6 ETA text with a tracked-leaker delay during display merge", () => {
    const out = mergeRumorRows([
      rrow({
        model_slug: "chatgpt",
        version_label: "GPT-5.6",
        claim_type: "launch",
        claim_summary: "GPT-5.6 was expected next week.",
        eta_text: "next week",
        mention_count: 2,
        last_seen_at: "2026-06-22",
        representative_sources: [{ url: "r", platform: "reddit" }],
      }),
      rrow({
        model_slug: "chatgpt",
        version_label: "GPT 5.6",
        claim_type: "delayed",
        claim_summary: "GPT-5.6 is delayed to mid-July.",
        eta_text: "mid-July",
        mention_count: 1,
        has_credible_source: true,
        last_seen_at: "2026-06-23",
        representative_sources: [{ url: "x", platform: "twitter", handle: "synthwavedd" }],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].claim_type).toBe("delayed");
    expect(out[0].claim_summary).toBe("GPT-5.6 is delayed to mid-July.");
    expect((out[0] as { eta_text?: string | null }).eta_text).toBe("mid-July");
    expect((out[0] as { representative_sources?: Array<{ source_quality?: string | null }> }).representative_sources?.[0].source_quality).toBe(
      "tracked_leaker",
    );
  });

  it("filters out non-frontier labels and untracked families", () => {
    const out = mergeRumorRows([
      rrow({ version_label: "Sonnet 5", representative_sources: [{ url: "a", platform: "reddit" }] }),
      rrow({ version_label: "DeepSeek V3" }), // competitor label
      rrow({ model_slug: "mistral", version_label: "Large 3" }), // untracked family
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].version_label).toBe("Sonnet 5");
  });
});

describe("formatRumorEta", () => {
  it("turns relative week phrases into absolute week windows", () => {
    expect(formatRumorEta({ eta_text: "next week", last_seen_at: "2026-06-24T03:00:00Z" })).toBe(
      "Week of Jun 29, 2026",
    );
    expect(formatRumorEta({ eta_text: "as early as next week", last_seen_at: "2026-06-24T03:00:00Z" })).toBe(
      "As early as the week of Jun 29, 2026",
    );
    expect(formatRumorEta({ eta_text: "this week", last_seen_at: "2026-06-24T03:00:00Z" })).toBe(
      "Week of Jun 22, 2026",
    );
  });

  it("keeps broad calendar windows broad", () => {
    expect(formatRumorEta({ eta_text: "mid-July", last_seen_at: "2026-06-24T03:00:00Z" })).toBe(
      "Mid-July 2026",
    );
    expect(formatRumorEta({ eta_text: "into July", last_seen_at: "2026-06-24T03:00:00Z" })).toBe(
      "July 2026",
    );
    expect(formatRumorEta({ eta_text: "Q3", last_seen_at: "2026-06-24T03:00:00Z" })).toBe("Q3 2026");
  });

  it("uses exact dates only when the source gives an exact anchor", () => {
    expect(formatRumorEta({ eta_text: "by July 1", last_seen_at: "2026-06-24T03:00:00Z" })).toBe(
      "By Jul 1, 2026",
    );
    expect(formatRumorEta({ eta_text: "week of July 30", last_seen_at: "2026-06-24T03:00:00Z" })).toBe(
      "Week of Jul 30, 2026",
    );
    expect(formatRumorEta({ eta_date: "2026-07-01" })).toBe("Jul 1, 2026");
  });
});
