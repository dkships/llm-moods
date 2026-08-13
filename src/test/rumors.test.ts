import { describe, expect, it } from "vitest";

import { formatRumorEta } from "../lib/rumor-eta";
import {
  isLikelyRumorCandidate,
  isRumorOrReleaseCandidate,
} from "../../supabase/functions/_shared/rumor-detect";
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
  dedupeRumorSources,
  inferSourceQuality,
  isFamilyConsistentLabel,
  isNonFrontierLabel,
  isReleasedVersion,
  isStrongPublicRumor,
  mergeRumorRows,
  releasedSetPrompt,
  rumorStrengthScore,
  sourceHandleFromUrl,
  sourceIdentityKey,
  sourceQualityLabel,
  splitCompoundLabel,
  versionKeysFromReleaseText,
  type MergeableRumor,
} from "../../supabase/functions/_shared/rumor-canon";
import {
  deriveReleasedTokens,
  modelIdToTokens,
  openAiReleasedTokensFromRss,
  parseOpenAiReleaseFeed,
} from "../../supabase/functions/_shared/released-models";
import { isCredibleReleaseSource, isReleaseAnnouncement } from "../../supabase/functions/_shared/release-detect";
import { VENDOR_EVENTS } from "../data/vendor-events";

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
      "GPT-6 appeared behind a feature flag in the model selector",
      "Claude Opus 5 entered internal testing",
      "Gemini 4 is in a private preview",
      "Grok 5 is being red-teamed before launch",
      "A new checkpoint was spotted under the Honeycomb codename",
      "The team is preparing to launch Fable 5.1",
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

  it("keeps both unreleased rumors and GA posts for the radar pipeline", () => {
    expect(isRumorOrReleaseCandidate("GPT-6 entered a limited preview", "")).toBe(true);
    expect(isRumorOrReleaseCandidate("GPT-5.6 is now available to everyone", "")).toBe(true);
    expect(isRumorOrReleaseCandidate("I use ChatGPT every day", "")).toBe(false);
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
      version_label: "Opus 5",
      is_unreleased: true,
      claim_type: "in_testing",
      claim_summary: "Available to select enterprise customers under EAP.",
      confidence: 0.7,
    };
    const c = buildContribution(raw, source, "Claude Opus 5 is in early access for enterprise");
    expect(c).not.toBeNull();
    expect(c!.modelSlug).toBe("claude");
    expect(c!.versionKey).toBe("opus5");
    expect(c!.claimType).toBe("in_testing");
  });

  it("drops sentiment, hypotheticals, and unsupported performance comparisons", () => {
    const base: RawClaim = {
      is_rumor: true,
      target_family: "claude",
      version_label: "Opus 5",
      is_unreleased: true,
      claim_type: "launch",
      confidence: 0.8,
    };
    expect(
      buildContribution(
        base,
        source,
        "Anthropic needs Opus 5 to hit just below Fable 5, so Fable 5.1 would make room for it.",
      ),
    ).toBeNull();
    expect(
      buildContribution(
        { ...base, claim_mode: "speculation", evidence_kind: "none" },
        source,
        "Opus 5 is probably coming someday.",
      ),
    ).toBeNull();
  });

  it("keeps an observed app artifact and stores its claim assessment", () => {
    const artifact = buildContribution(
      {
        is_rumor: true,
        target_family: "claude",
        codename: "Honeycomb",
        is_unreleased: true,
        claim_type: "in_testing",
        claim_mode: "observed_signal",
        evidence_kind: "artifact",
        confidence: 0.82,
      },
      source,
      "Honeycomb appeared in Cursor app data with a new context setting.",
    );
    expect(artifact?.source.claim_mode).toBe("observed_signal");
    expect(artifact?.source.evidence_kind).toBe("artifact");
    expect(isCredibleSource(artifact!.source)).toBe(true);
  });

  it("drops low-confidence extracted claims", () => {
    expect(
      buildContribution(
        {
          is_rumor: true,
          target_family: "chatgpt",
          version_label: "GPT-6",
          is_unreleased: true,
          claim_mode: "reported_information",
          evidence_kind: "none",
          confidence: 0.3,
        },
        source,
        "GPT-6 is coming soon, according to gossip.",
      ),
    ).toBeNull();
  });

  it("drops non-rumors, released versions, and unknown family", () => {
    const base: RawClaim = { is_rumor: true, target_family: "claude", version_label: "Opus 5", is_unreleased: true };
    expect(buildContribution({ ...base, is_rumor: false }, source, "Opus 5")).toBeNull();
    expect(buildContribution({ ...base, is_unreleased: false }, source, "Opus 5")).toBeNull();
    expect(buildContribution({ ...base, target_family: "unknown" }, source, "Opus 5")).toBeNull();
    // A version that has now shipped is dropped even when the model judged it unreleased.
    expect(buildContribution({ ...base, version_label: "Sonnet 5" }, source, "Sonnet 5 rumor")).toBeNull();
  });

  it("drops a claim with no version or codename", () => {
    const raw: RawClaim = { is_rumor: true, target_family: "gemini", is_unreleased: true };
    expect(buildContribution(raw, source, "something about gemini")).toBeNull();
  });

  it("anti-hallucination: drops a version_label not present in the post text", () => {
    const raw: RawClaim = { is_rumor: true, target_family: "claude", version_label: "Opus 5", is_unreleased: true };
    expect(buildContribution(raw, source, "just talking about claude in general")).toBeNull();
  });

  it("accepts a codename-only claim without the substring check", () => {
    const raw: RawClaim = { is_rumor: true, target_family: "gemini", codename: "Orionmist", is_unreleased: true };
    const c = buildContribution(raw, source, "Orionmist topping the arena");
    expect(c?.versionKey).toBe("orionmist");
  });

  it("accepts a punctuation-variant label for an unreleased version", () => {
    const raw: RawClaim = { is_rumor: true, target_family: "chatgpt", version_label: "GPT-6.1", is_unreleased: true };
    const c = buildContribution(raw, source, "GPT-6,1 dropping next week per a leaker");
    expect(c).not.toBeNull();
    expect(c!.modelSlug).toBe("chatgpt");
  });

  it("writes a numbered ChatGPT codename claim to the generation identity", () => {
    const raw: RawClaim = {
      is_rumor: true,
      target_family: "chatgpt",
      version_label: "GPT-6 Sol",
      codename: "Sol",
      is_unreleased: true,
    };
    const c = buildContribution(raw, source, "GPT-6 Sol was spotted in testing");
    expect(c?.versionKey).toBe("gpt6");
    expect(c?.versionLabel).toBe("GPT-6");
    expect(c?.codename).toBe("Sol");
  });

  it("drops a competitor label mis-attributed to a tracked family", () => {
    const raw: RawClaim = { is_rumor: true, target_family: "gemini", version_label: "DeepSeek V3", is_unreleased: true };
    expect(buildContribution(raw, source, "DeepSeek V3 is coming soon")).toBeNull();
  });

  it("drops every released Bidi alias even when the model marks it unreleased", () => {
    const bidi = buildContribution(
      { is_rumor: true, target_family: "chatgpt", codename: "Bidi", is_unreleased: true },
      source,
      "Bidi spotted in the API",
    );
    const gptBidi = buildContribution(
      { is_rumor: true, target_family: "chatgpt", version_label: "GPT Bidi 1", is_unreleased: true },
      source,
      "GPT Bidi 1 launching soon",
    );
    expect(bidi).toBeNull();
    expect(gptBidi).toBeNull();
  });

  it("drops a launched version even when the model marks it unreleased", () => {
    const launched: RawClaim[] = [
      { is_rumor: true, target_family: "claude", codename: "Mythos", is_unreleased: true, claim_type: "return", eta_text: "mid-July" },
      { is_rumor: true, target_family: "claude", version_label: "Fable 5", is_unreleased: true, claim_type: "launch" },
      { is_rumor: true, target_family: "claude", version_label: "Sonnet 5", is_unreleased: true, claim_type: "launch" },
    ];
    for (const raw of launched) {
      const text = `${raw.version_label ?? raw.codename} details in the post`;
      expect(buildContribution(raw, source, text)).toBeNull();
    }
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

  it("counts multiple posts from the same account as one corroborating source", () => {
    const repeatedAccount = [
      contrib({ source: src("https://x.com/one/status/1", "twitter", "2026-06-22", 1, { handle: "one" }) }),
      contrib({ source: src("https://x.com/one/status/2", "twitter", "2026-06-23", 2, { handle: "one" }) }),
    ];
    const row = mergeCluster(null, repeatedAccount, 12);
    expect(row.mention_count).toBe(1);
    expect(row.representative_sources).toHaveLength(1);
    expect(row.representative_sources[0].url).toBe("https://x.com/one/status/2");
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

  it("keeps an observed artifact ahead of a weaker imminent claim", () => {
    const row = mergeCluster(
      null,
      [
        contrib({
          versionKey: "opus5",
          versionLabel: "Opus 5",
          codename: "Honeycomb",
          claimType: "imminent",
          claimSummary: "Opus 5 is dropping Monday.",
          source: src("https://x.com/unknown/status/1", "twitter", "2026-07-12", 0),
        }),
        contrib({
          versionKey: "opus5",
          versionLabel: "Opus 5",
          codename: "Honeycomb",
          claimType: "in_testing",
          claimSummary: "Honeycomb appeared in Cursor app data.",
          source: src("https://x.com/researcher/status/2", "twitter", "2026-07-11", 0, {
            claim_mode: "observed_signal",
            evidence_kind: "artifact",
          }),
        }),
      ],
      12,
    );
    expect(row.claim_type).toBe("in_testing");
    expect(row.claim_summary).toBe("Honeycomb appeared in Cursor app data.");
  });

  it("caps representative_sources to the top N by score", () => {
    const many = [10, 40, 20, 5, 30].map((s, i) => contrib({ source: src(`u${i}`, "reddit", "2026-06-22", s) }));
    const row = mergeCluster(null, many, 2);
    expect(row.representative_sources).toHaveLength(2);
    expect(row.representative_sources.map((r) => r.score)).toEqual([40, 30]);
  });
});

describe("credibility", () => {
  it("flags vetted sources but does not treat engagement alone as credibility", () => {
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { handle: "synthwavedd" }))).toBe(true);
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { handle: "@SynthWaveDD" }))).toBe(true); // normalized
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { handle: "@M1Astra" }))).toBe(true);
    expect(isCredibleSource(src("https://x.com/axios/status/1", "twitter", "2026-06-22", 0, { handle: "@axios" }))).toBe(true);
    expect(isCredibleSource(src("https://x.com/alexeheath/status/1", "twitter", "2026-06-22", 0, { handle: "@alexeheath" }))).toBe(true);
    expect(isCredibleSource(src("https://x.com/OpenAI/status/1", "twitter", "2026-06-22", 0, { handle: "@OpenAI" }))).toBe(true);
    expect(isCredibleSource(src("https://x.com/someone/status/2", "twitter", "2026-06-22", 0, { quotedStatusId: "1" }))).toBe(false);
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { verified: true }))).toBe(false);
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { verified: true, followers: 50000 }))).toBe(false);
    expect(isCredibleSource(src("u", "reddit", "2026-06-22", 500))).toBe(false);
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 1000, { handle: "bedros_p" }))).toBe(false);
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 1000, { handle: "nima_owji" }))).toBe(false);
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { handle: "Fried_rice" }))).toBe(true);
    expect(isCredibleSource(src("u", "twitter", "2026-06-22", 0, { handle: "pankajkumar_dev" }))).toBe(true);
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
    expect(inferSourceQuality({ url: "https://x.com/OpenAI/status/1", platform: "twitter", handle: "@OpenAI" })).toBe(
      "official",
    );
    expect(inferSourceQuality({ url: "https://x.com/Fried_rice/status/1", platform: "twitter" })).toBe(
      "artifact_leak",
    );
    expect(inferSourceQuality({ url: "https://x.com/haydenfield/status/1", platform: "twitter" })).toBe(
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

describe("independent source identity", () => {
  it("recovers handles from X and Bluesky URLs", () => {
    expect(sourceHandleFromUrl("https://x.com/SynthWaveDD/status/1")).toBe("synthwavedd");
    expect(sourceHandleFromUrl("https://bsky.app/profile/timkellogg.me/post/abc")).toBe("timkellogg.me");
  });

  it("counts repeated account posts and shared quote echoes as one origin", () => {
    expect(sourceIdentityKey({ url: "https://x.com/a/status/1", platform: "twitter" })).toBe(
      sourceIdentityKey({ url: "https://x.com/a/status/2", platform: "twitter" }),
    );
    expect(sourceIdentityKey({ url: "x", platform: "twitter", quotedStatusId: "99" })).toBe(
      sourceIdentityKey({ url: "y", platform: "twitter", quotedStatusId: "99" }),
    );
    expect(dedupeRumorSources([
      { url: "https://x.com/original/status/99", platform: "twitter" },
      { url: "https://news.ycombinator.com/item?id=1", platform: "hackernews", quotedStatusId: "99" },
    ])).toHaveLength(1);
  });
});

describe("deterministic rumor recovery", () => {
  it("recovers the unreleased Gemini claim but drops the launched GPT-5.6 claim", () => {
    const source = src("https://x.com/synthwavedd/status/2069432791184650426", "twitter", "2026-06-24", 4, {
      handle: "synthwavedd",
    });
    const text = [
      "June delays:",
      "GPT-5.6 delayed to mid-July.",
      "3.5 Pro is in testing with limited access.",
    ].join("\n");

    const claims = recoverDeterministicClaims(source, text);
    expect(claims).toHaveLength(1);

    const contributions = claims
      .map((raw) => buildContribution(raw, source, text))
      .filter(Boolean) as RumorContribution[];
    expect(contributions.map((c) => `${c.modelSlug}:${c.versionKey}:${c.claimType}`)).toEqual([
      "gemini:gemini35pro:in_testing",
    ]);
    expect(contributions[0].versionLabel).toBe("Gemini 3.5 Pro");
  });

  it("does not recover from low-signal uncorroborated posts", () => {
    const weakSource = src("u", "bluesky", "2026-06-24", 1);
    expect(recoverDeterministicClaims(weakSource, "GPT-5.6 delayed to mid-July. 3.5 Pro in testing.")).toEqual([]);
  });

  it("does not recover a released GPT-5.6 partner-preview claim", () => {
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
    expect(claims).toEqual([]);
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

  it("uses an existing label-codename bridge to route codename-only claims", () => {
    const honeycomb = contrib({
      versionKey: "honeycomb",
      versionLabel: null,
      codename: "Honeycomb",
      source: src("h", "hackernews", "2026-07-12"),
    });
    const groups = groupByCluster([honeycomb], [
      {
        model_slug: "claude",
        version_key: "opus5",
        version_label: "Opus 5",
        codename: "Honeycomb",
      },
      {
        model_slug: "claude",
        version_key: "honeycomb",
        version_label: null,
        codename: "Honeycomb",
      },
    ]);
    expect([...groups.keys()]).toEqual(["claude:opus5"]);
    expect(groups.get("claude:opus5")?.[0]).toMatchObject({
      versionKey: "opus5",
      versionLabel: "Opus 5",
      codename: "Honeycomb",
    });
  });
});

describe("statusIdFromUrl / collapseQuoteEchoes", () => {
  it("extracts the tweet status id from a url", () => {
    expect(statusIdFromUrl("https://x.com/synthwavedd/status/12345")).toBe("12345");
    expect(statusIdFromUrl("https://bsky.app/profile/example.com/post/3abc")).toBe("3abc");
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
      ["GPT-Live", null],
      ["GPT-Live-1", null],
    ] as [string | null, string | null][]) {
      const c = canonicalVersionKey("chatgpt", label, codename);
      expect(c.key).toBe("bidi");
      expect(c.label).toBe("GPT Bidi 1");
      expect(c.codename).toBe("Bidi");
    }
  });

  it("collapses Gemini 3.5 Pro spelling variants to one canonical identity", () => {
    for (const label of ["3.5 Pro", "Gemini 3.5 Pro", "Gemini-3.5-Pro", "Gemini 3.5", "3.5"]) {
      const c = canonicalVersionKey("gemini", label, null);
      expect(c.key).toBe("gemini35pro");
      expect(c.label).toBe("Gemini 3.5 Pro");
      expect(c.codename).toBeNull();
    }
  });

  it("collapses numbered ChatGPT generation/codename spellings without merging product variants", () => {
    for (const [label, codename] of [
      ["GPT-6", null],
      ["ChatGPT 6", null],
      ["6", null],
      ["GPT-6 Sol", "Sol"],
      ["GPT-6 Sol", "Sol, Terra, Luna"],
    ] as [string, string | null][]) {
      const c = canonicalVersionKey("chatgpt", label, codename);
      expect(c.key).toBe("gpt6");
      expect(c.label).toBe("GPT-6");
    }

    expect(canonicalVersionKey("chatgpt", "GPT-6 Mini", null).key).toBe("gpt6mini");
    expect(canonicalVersionKey("gemini", "Gemini 4 Pro", null).key).not.toBe(
      canonicalVersionKey("gemini", "Gemini 4 Flash", null).key,
    );
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

describe("isReleasedVersion", () => {
  it("flags launched versions across every spelling", () => {
    expect(isReleasedVersion("claude", "Fable 5", null)).toBe(true);
    expect(isReleasedVersion("claude", null, "Mythos")).toBe(true);
    expect(isReleasedVersion("claude", "Mythos/Fable 5", null)).toBe(true);
    expect(isReleasedVersion("claude", "Sonnet 5", null)).toBe(true);
    expect(isReleasedVersion("claude", "Sonic 5", null)).toBe(true); // common mis-spelling
    expect(isReleasedVersion("claude", "Claude Sonnet 5", null)).toBe(true); // family-prefixed
    expect(isReleasedVersion("chatgpt", "GPT-5.6", null)).toBe(true);
    expect(isReleasedVersion("chatgpt", "GPT-5.6 Sol", null)).toBe(true);
    expect(isReleasedVersion("chatgpt", null, "Bidi")).toBe(true);
    expect(isReleasedVersion("chatgpt", "GPT-Live-1", null)).toBe(true);
    expect(isReleasedVersion("grok", "Grok 4.5", null)).toBe(true);
    expect(isReleasedVersion("grok", "Grok 4.6", null)).toBe(true);
    expect(isReleasedVersion("grok", "Fable 5", null)).toBe(true); // family-agnostic
    expect(isReleasedVersion("gemini", "Gemini 3.5 Flash Cyber", null)).toBe(true);
    expect(isReleasedVersion("gemini", "Flash Cyber", null)).toBe(true);
    expect(isReleasedVersion("gemini", "Gemini 3.1 Pro", null)).toBe(true);
    expect(isReleasedVersion("gemini", "Gemini 3.6 Flash", null)).toBe(true);
    expect(isReleasedVersion("gemini", "Gemini 3.5 Flash-Lite", null)).toBe(true);
  });

  it("keeps unreleased versions (no false positives)", () => {
    expect(isReleasedVersion("claude", "Opus 5", null)).toBe(false);
    expect(isReleasedVersion("chatgpt", "GPT-6", null)).toBe(false);
    expect(isReleasedVersion("gemini", "Gemini 3.5 Pro", null)).toBe(false);
    expect(isReleasedVersion("grok", "Grok 5", null)).toBe(false);
    expect(isReleasedVersion("grok", "Grok 4.7", null)).toBe(false);
    // The shipped 3.5 Flash-Lite must not retire the next one by bare-name match.
    expect(isReleasedVersion("gemini", "Gemini 3.6 Flash-Lite", null)).toBe(false);
    expect(isReleasedVersion("gemini", "Flash-Lite", null)).toBe(false);
  });

  it("covers every model launch recorded in the vendor event timeline", () => {
    for (const event of VENDOR_EVENTS.filter((item) => item.eventType === "model_launch" && item.modelSlug)) {
      const label = event.title.replace(/\s+launch$/i, "");
      expect(isReleasedVersion(event.modelSlug, label, null), event.id).toBe(true);
    }
  });
});

describe("released model catalog", () => {
  it("generates the extractor prompt from the shared release entries", () => {
    const prompt = releasedSetPrompt();
    expect(prompt).toContain("GPT-5.6 (Sol, Terra, Luna) and earlier");
    expect(prompt).toContain("GPT-Live 1 / Bidi");
    expect(prompt).toContain("Grok 4.6 and earlier");
    expect(prompt).toContain("Gemini 3.6 Flash");
    // Superseded snapshots drop their prompt wording; the token still retires.
    expect(prompt).not.toContain("Grok 4.5 and earlier");
  });

  it("extracts known aliases and future numbered labels from release text", () => {
    expect(versionKeysFromReleaseText("GPT-5.6 Sol and GPT-Live are now available")).toEqual(
      expect.arrayContaining(["gpt56", "bidi"]),
    );
    expect(versionKeysFromReleaseText("Today we're launching Grok 5 and GPT-6.1")).toEqual(
      expect.arrayContaining(["grok5", "gpt61"]),
    );
  });
});

describe("modelIdToTokens / deriveReleasedTokens (API auto-detect)", () => {
  it("maps Anthropic ids to full + family-stripped tokens, stripping dated snapshots", () => {
    expect(modelIdToTokens("claude-sonnet-5")).toEqual(expect.arrayContaining(["claudesonnet5", "sonnet5"]));
    expect(modelIdToTokens("claude-fable-5")).toEqual(expect.arrayContaining(["fable5"]));
    expect(modelIdToTokens("claude-haiku-4-5-20251001")).toEqual(expect.arrayContaining(["haiku45"]));
  });

  it("maps Gemini ids (models/ prefix) to matching tokens", () => {
    expect(modelIdToTokens("models/gemini-3-pro")).toEqual(expect.arrayContaining(["gemini3pro", "3pro"]));
  });

  it("derived tokens match the rumor version_keys they should retire", () => {
    const anthropic = new Set(deriveReleasedTokens(["claude-sonnet-5"], []));
    expect(anthropic.has(canonicalVersionKey("claude", "Sonnet 5", null).key!)).toBe(true);
    const gemini = new Set(deriveReleasedTokens([], ["models/gemini-3-pro"]));
    expect(gemini.has(canonicalVersionKey("gemini", "Gemini 3 Pro", null).key!)).toBe(true);
    // An unreleased rumor's key is NOT in the shipped-token set.
    expect(anthropic.has(canonicalVersionKey("claude", "Opus 5", null).key!)).toBe(false);
  });
});

describe("OpenAI official release feed", () => {
  const rss = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title><![CDATA[GPT-5.6 is now the preferred model]]></title>
        <description><![CDATA[GPT-5.6 powers current production workflows.]]></description>
        <link>https://openai.com/index/gpt-5-6</link>
        <category><![CDATA[Product]]></category>
        <pubDate>Thu, 09 Jul 2026 10:00:00 GMT</pubDate>
      </item>
      <item>
        <title><![CDATA[Introducing GPT-Live]]></title>
        <description><![CDATA[Now powering ChatGPT Voice.]]></description>
        <link>https://openai.com/index/introducing-gpt-live</link>
        <category><![CDATA[Product]]></category>
      </item>
      <item>
        <title><![CDATA[Previewing GPT-6]]></title>
        <description><![CDATA[A limited preview for select partners.]]></description>
        <link>https://openai.com/index/previewing-gpt-6</link>
        <category><![CDATA[Product]]></category>
      </item>
    </channel></rss>`;

  it("parses item metadata", () => {
    const items = parseOpenAiReleaseFeed(rss);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      title: "GPT-5.6 is now the preferred model",
      category: "Product",
      publishedAt: "Thu, 09 Jul 2026 10:00:00 GMT",
    });
  });

  it("retires GA products but not previews", () => {
    const tokens = openAiReleasedTokensFromRss(rss);
    expect(tokens).toEqual(expect.arrayContaining(["gpt56", "bidi"]));
    expect(tokens).not.toContain("gpt6");
  });
});

describe("release-detect (social auto-detect)", () => {
  const officialTweet = { url: "https://x.com/OpenAI/status/1", platform: "twitter", handle: "OpenAI" };
  const randomTweet = { url: "https://x.com/someguy/status/2", platform: "twitter", handle: "someguy" };

  it("flags a generally-available announcement", () => {
    expect(isReleaseAnnouncement("GPT-5.6 is now available to everyone", "")).toBe(true);
    expect(isReleaseAnnouncement("Grok 5 released today", "you can use it now")).toBe(true);
    expect(isReleaseAnnouncement("Gemini 3 Pro is now live", null)).toBe(true);
    expect(isReleaseAnnouncement("GPT-5.6", "We're launching for general availability after our limited preview.")).toBe(true);
    expect(isReleaseAnnouncement("Introducing GPT-Live", "Now powering ChatGPT Voice.")).toBe(true);
    expect(isReleaseAnnouncement("Today, we're launching Grok 4.5", "")).toBe(true);
  });

  it("does not flag hype, future tense, or a limited/EAP release", () => {
    expect(isReleaseAnnouncement("GPT-5.6 is basically out", "")).toBe(false);
    expect(isReleaseAnnouncement("Sonnet 5 will launch next week", "")).toBe(false);
    expect(isReleaseAnnouncement("GPT-5.6 now available for enterprise partners", "for testing")).toBe(false);
    expect(isReleaseAnnouncement("Opus 5 rumored to drop soon", "")).toBe(false);
  });

  it("trusts official handles, vendor domains, and press scoops; not random accounts", () => {
    expect(isCredibleReleaseSource(officialTweet)).toBe(true);
    expect(isCredibleReleaseSource({ url: "https://openai.com/index/gpt-5-6", platform: "web" })).toBe(true);
    expect(isCredibleReleaseSource({ url: "https://x.com/axios/status/3", platform: "twitter", handle: "axios" })).toBe(true);
    expect(isCredibleReleaseSource(randomTweet)).toBe(false);
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
      rrow({ model_slug: "gemini", version_label: "3.5 Pro", mention_count: 1, last_seen_at: "2026-06-22",
        representative_sources: [{ url: "u1", platform: "twitter" }] }),
      rrow({ model_slug: "gemini", version_label: "Gemini 3.5 Pro", mention_count: 1, last_seen_at: "2026-06-23",
        representative_sources: [{ url: "u2", platform: "reddit" }] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].version_label).toBe("Gemini 3.5 Pro");
    expect(out[0].codename).toBeNull();
    expect(out[0].mention_count).toBe(2); // single-unconfirmed-source tag now clears
    expect(out[0].platform_count).toBe(2);
  });

  it("folds bare 'Gemini 3.5' chatter into the Pro card and retires shipped Flash Cyber (live board 2026-07-24)", () => {
    const out = mergeRumorRows([
      rrow({ model_slug: "gemini", version_label: "Gemini 3.5 Pro", claim_type: "delayed", last_seen_at: "2026-07-24",
        representative_sources: [{ url: "u1", platform: "twitter" }] }),
      rrow({ model_slug: "gemini", version_label: "Gemini 3.5", claim_type: "delayed", last_seen_at: "2026-07-22",
        representative_sources: [{ url: "u2", platform: "reddit" }] }),
      rrow({ model_slug: "gemini", version_label: "Gemini 3.5 Flash Cyber", claim_type: "in_testing", last_seen_at: "2026-07-22",
        representative_sources: [{ url: "u3", platform: "hackernews" }] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].version_label).toBe("Gemini 3.5 Pro");
    expect(out[0].mention_count).toBe(2);
    expect(out[0].platform_count).toBe(2);
  });

  it("collapses a numbered ChatGPT generation and repeated-codename row into one card", () => {
    const out = mergeRumorRows([
      rrow({
        model_slug: "chatgpt",
        version_label: "GPT-6",
        codename: "Sol, Terra, Luna",
        representative_sources: [{ url: "x", platform: "twitter" }],
      }),
      rrow({
        model_slug: "chatgpt",
        version_label: "GPT-6 Sol",
        codename: "Sol",
        last_seen_at: "2026-06-24",
        representative_sources: [{ url: "b", platform: "bluesky" }],
      }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].version_label).toBe("GPT-6");
    expect(out[0].codename).toBe("Sol, Terra, Luna");
    expect(out[0].mention_count).toBe(2);
    expect(out[0].platform_count).toBe(2);
  });

  it("collapses unreleased alias rows and preserves the newest stated ETA", () => {
    const out = mergeRumorRows([
      rrow({
        model_slug: "gemini",
        version_label: "3.5 Pro",
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
        model_slug: "gemini",
        version_label: "Gemini 3.5 Pro",
        claim_type: "in_testing",
        mention_count: 1,
        last_seen_at: "2026-06-24",
        representative_sources: [{ url: "t", platform: "twitter" }],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].version_label).toBe("Gemini 3.5 Pro");
    expect(out[0].codename).toBeNull();
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
      rrow({ model_slug: "gemini", version_label: "3.5 Pro", representative_sources: [{ url: "shared", platform: "twitter" }] }),
      rrow({ model_slug: "gemini", version_label: "Gemini 3.5 Pro", representative_sources: [{ url: "shared", platform: "twitter" }] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].mention_count).toBe(1);
  });

  it("applies claim_type precedence and takes display fields from the strongest row", () => {
    const out = mergeRumorRows([
      rrow({ model_slug: "gemini", version_label: "3.5 Pro", claim_type: "launch", claim_summary: "old", last_seen_at: "2026-06-20",
        representative_sources: [{ url: "a", platform: "reddit" }] }),
      rrow({ model_slug: "gemini", version_label: "Gemini 3.5 Pro", claim_type: "delayed", claim_summary: "newest", last_seen_at: "2026-06-24",
        representative_sources: [{ url: "b", platform: "twitter" }] }),
    ]);
    expect(out[0].claim_type).toBe("delayed");
    expect(out[0].claim_summary).toBe("newest");
  });

  it("auto-links a version/codename bridge and lets artifact evidence lead", () => {
    const out = mergeRumorRows([
      rrow({
        version_label: "Opus 5",
        codename: "Honeycomb",
        claim_type: "imminent",
        claim_summary: "Opus 5 is dropping Monday.",
        signals: "speculative comparison",
        mention_count: 8,
        platform_count: 2,
        representative_sources: [
          {
            url: "https://x.com/theRattey/status/1",
            platform: "twitter",
            snippet: "they are dropping opus 5 on monday",
          },
          {
            url: "https://bsky.app/profile/timkellogg.me/post/one",
            platform: "bluesky",
            snippet: "Anthropic needs Opus 5 to hit below Fable, so Fable 5.1 would make room.",
          },
          {
            url: "https://bsky.app/profile/cameron.stream/post/two",
            platform: "bluesky",
            snippet: "If I were them, I would announce Opus 5 this week.",
          },
        ],
      }),
      rrow({
        version_label: null,
        codename: "Honeycomb",
        claim_type: "in_testing",
        claim_summary: "Honeycomb appeared in Cursor app data.",
        signals: "Cursor app data / codename leak",
        mention_count: 3,
        platform_count: 2,
        last_seen_at: "2026-07-12",
        representative_sources: [
          { url: "https://x.com/real_klea/status/2", platform: "twitter" },
          { url: "https://news.ycombinator.com/item?id=3", platform: "hackernews" },
          { url: "https://x.com/SerAlpha_AI/status/4", platform: "twitter" },
        ],
      }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      version_label: "Opus 5",
      codename: "Honeycomb",
      claim_type: "in_testing",
      claim_summary: "Honeycomb appeared in Cursor app data.",
      mention_count: 3,
      platform_count: 2,
    });
    expect(out[0].representative_sources?.map((source) => source.handle)).not.toContain("timkellogg.me");
  });

  it("requires independent origins for untracked cards", () => {
    const repeated = mergeRumorRows([
      rrow({
        model_slug: "chatgpt",
        version_label: "GPT-6",
        mention_count: 2,
        platform_count: 1,
        representative_sources: [
          { url: "https://bsky.app/profile/one.test/post/a", platform: "bluesky" },
          { url: "https://bsky.app/profile/one.test/post/b", platform: "bluesky" },
        ],
      }),
    ])[0];
    expect(repeated.mention_count).toBe(1);
    expect(isStrongPublicRumor(repeated)).toBe(false);

    const tracked = mergeRumorRows([
      rrow({
        model_slug: "gemini",
        version_label: "Gemini 3.5 Pro",
        representative_sources: [
          { url: "https://x.com/synthwavedd/status/1", platform: "twitter" },
        ],
      }),
    ])[0];
    expect(isStrongPublicRumor(tracked)).toBe(true);
    expect(rumorStrengthScore(tracked)).toBeGreaterThan(rumorStrengthScore(repeated));
  });

  it("filters all persisted spellings of newly launched models", () => {
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
        version_label: "GPT-5.6 Sol",
        last_seen_at: "2026-06-23",
        representative_sources: [{ url: "x", platform: "twitter" }],
      }),
      rrow({ model_slug: "chatgpt", codename: "Bidi" }),
      rrow({ model_slug: "chatgpt", version_label: "GPT-Live-1" }),
      rrow({ model_slug: "grok", version_label: "Grok 4.5" }),
    ]);
    expect(out).toEqual([]);
  });

  it("filters out non-frontier labels and untracked families", () => {
    const out = mergeRumorRows([
      rrow({ version_label: "Opus 5", representative_sources: [{ url: "a", platform: "reddit" }] }),
      rrow({ version_label: "DeepSeek V3" }), // competitor label
      rrow({ model_slug: "mistral", version_label: "Large 3" }), // untracked family
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].version_label).toBe("Opus 5");
  });

  it("drops rows for versions that have launched", () => {
    const out = mergeRumorRows([
      rrow({ version_label: "Opus 5", representative_sources: [{ url: "a", platform: "reddit" }] }),
      rrow({ codename: "Mythos" }), // Fable 5 shipped
      rrow({ version_label: "Sonnet 5" }), // shipped
      rrow({ version_label: "Claude Sonnet 5" }), // shipped, family-prefixed spelling
      rrow({ model_slug: "chatgpt", version_label: "GPT-5.6" }),
      rrow({ model_slug: "chatgpt", codename: "Bidi" }),
      rrow({ model_slug: "grok", version_label: "Grok 4.5" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].version_label).toBe("Opus 5");
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
