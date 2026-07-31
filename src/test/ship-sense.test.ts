import { describe, expect, it } from "vitest";
import {
  leaderBand,
  lineage,
  orientPair,
  successions,
  type DeriveModel,
} from "../../scripts/ship-sense-derive";
import {
  SHIP_SENSE_GENERATIONS,
  SHIP_SENSE_LINEUP,
  SHIP_SENSE_RUN,
} from "@/data/ship-sense-snapshot";
import { SHIP_SENSE_TEASER } from "@/data/ship-sense-teaser";

const model = (
  name: string,
  label: string,
  score: number,
  lo: number,
  hi: number,
  extra: Partial<DeriveModel> = {},
): DeriveModel => ({
  name,
  label,
  is_baseline: false,
  score: { value: score, lo, hi },
  ...extra,
});

describe("lineage", () => {
  it("extracts family and version from versioned labels", () => {
    expect(lineage("Claude Sonnet 4.6")).toEqual({ family: "claude sonnet", version: [4, 6] });
    expect(lineage("Claude Sonnet 5")).toEqual({ family: "claude sonnet", version: [5] });
    expect(lineage("Kimi K3")).toEqual({ family: "kimi", version: [3] });
    expect(lineage("Gemini 3.5 Flash-Lite")).toEqual({ family: "gemini flash lite", version: [3, 5] });
  });

  it("returns a null version for unversioned labels (never auto-retires)", () => {
    expect(lineage("Naive baseline").version).toBeNull();
  });

  it("does not see GPT-5.5 and GPT-5.6 Sol as one lineage (renamed line)", () => {
    expect(lineage("GPT-5.5").family).not.toEqual(lineage("GPT-5.6 Sol").family);
  });
});

describe("successions", () => {
  it("retires a model when a ranked line-mate carries a higher version", () => {
    const models = [
      model("claude-sonnet-5", "Claude Sonnet 5", 77, 72, 83),
      model("claude-sonnet-4-6", "Claude Sonnet 4.6", 83, 79, 87),
    ];
    expect(successions(models, new Map())).toEqual(
      new Map([["claude-sonnet-4-6", "claude-sonnet-5"]]),
    );
  });

  it("shorter version tuples beat longer ones only when greater (5 > 4.6)", () => {
    const models = [
      model("a-4-6", "Thing 4.6", 80, 75, 85),
      model("a-5", "Thing 5", 80, 75, 85),
    ];
    expect(successions(models, new Map()).get("a-4-6")).toBe("a-5");
    expect(successions(models, new Map()).has("a-5")).toBe(false);
  });

  it("explicit declarations retire renamed lines and beat inference", () => {
    const models = [
      model("gpt-5.5", "GPT-5.5", 87, 83, 90),
      model("gpt-5.6-sol", "GPT-5.6 Sol", 86, 83, 89),
    ];
    const declared = new Map([["gpt-5.5", "gpt-5.6-sol"]]);
    expect(successions(models, declared).get("gpt-5.5")).toBe("gpt-5.6-sol");
  });

  it("never retires on the strength of an unranked successor", () => {
    const models = [
      model("a-1", "Thing 1", 80, 75, 85),
      model("a-2", "Thing 2", 82, 77, 87, { ranked_eligible: false }),
    ];
    expect(successions(models, new Map()).size).toBe(0);
  });
});

describe("leaderBand", () => {
  it("compares against the band leader, not the adjacent row", () => {
    // b overlaps leader; c overlaps b but NOT the leader's lo — a chain of
    // overlaps must not extend the band.
    const sorted = [
      model("a", "A 1", 90, 87, 93),
      model("b", "B 1", 88, 86, 91),
      model("c", "C 1", 86, 84, 89),
    ];
    // c.hi (89) >= a.lo (87) so c IS in the leader band; move c down.
    const sorted2 = [
      model("a", "A 1", 90, 88, 93),
      model("b", "B 1", 89, 85, 92),
      model("c", "C 1", 84, 80, 87.9),
    ];
    expect([...leaderBand(sorted)]).toEqual(["a", "b", "c"]);
    expect([...leaderBand(sorted2)]).toEqual(["a", "b"]);
  });

  it("a band of one is no band", () => {
    const sorted = [
      model("a", "A 1", 90, 88, 93),
      model("b", "B 1", 80, 78, 83),
    ];
    expect(leaderBand(sorted).size).toBe(0);
  });
});

describe("orientPair", () => {
  const rec = {
    a: "claude-sonnet-4-6",
    b: "claude-sonnet-5",
    delta: 0.052,
    lo: 0.002,
    hi: 0.109,
    holm_p: 1.0,
    winner: null,
  };

  it("flips a prev-first record to current-minus-previous with negated, swapped CI", () => {
    const out = orientPair(rec, "claude-sonnet-4-6", "claude-sonnet-5")!;
    expect(out.deltaPts).toBeCloseTo(-5.2, 5);
    expect(out.loPts).toBeCloseTo(-10.9, 5);
    expect(out.hiPts).toBeCloseTo(-0.2, 5);
    expect(out.verdict).toBe("suggestive-down");
  });

  it("keeps a curr-first record as-is", () => {
    const out = orientPair(
      { ...rec, a: "claude-sonnet-5", b: "claude-sonnet-4-6" },
      "claude-sonnet-4-6",
      "claude-sonnet-5",
    )!;
    expect(out.deltaPts).toBeCloseTo(5.2, 5);
    expect(out.verdict).toBe("suggestive-up");
  });

  it("a published Holm winner is decisive regardless of CI", () => {
    const out = orientPair(
      { ...rec, winner: "claude-sonnet-4-6" },
      "claude-sonnet-4-6",
      "claude-sonnet-5",
    )!;
    expect(out.verdict).toBe("decisive-down");
  });
});

describe("committed snapshot invariants", () => {
  it("holds the board shape the page renders", () => {
    expect(SHIP_SENSE_LINEUP).toHaveLength(13);
    expect(SHIP_SENSE_GENERATIONS).toHaveLength(8);
    expect(SHIP_SENSE_RUN.totalPairs).toBe(210);
  });

  it("is sorted by score with contiguous positions", () => {
    SHIP_SENSE_LINEUP.forEach((m, i) => {
      expect(m.pos).toBe(i + 1);
      if (i > 0) expect(m.score).toBeLessThanOrEqual(SHIP_SENSE_LINEUP[i - 1].score);
    });
  });

  it("teaser mirrors the lineup's top three", () => {
    expect(SHIP_SENSE_TEASER).toEqual(
      SHIP_SENSE_LINEUP.slice(0, 3).map((m) => ({ label: m.label, score: m.score })),
    );
  });

  it("leader band is a prefix of the lineup", () => {
    const lastInBand = SHIP_SENSE_LINEUP.filter((m) => m.inLeaderBand).length;
    SHIP_SENSE_LINEUP.forEach((m, i) => {
      expect(m.inLeaderBand).toBe(i < lastInBand);
    });
  });
});
