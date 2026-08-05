import { describe, expect, it } from "vitest";
import {
  leaderBand,
  lineage,
  orientPair,
  scoringDates,
  successions,
  type DeriveModel,
} from "../../scripts/ship-sense-derive";
import {
  describeScoringDates,
  providerLabel,
  scoredWindowLabel,
  type ShipSenseRunMeta,
} from "@/data/ship-sense";
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

describe("scoringDates", () => {
  const m = (label: string, price_verified: string | null) => ({ label, price_verified });

  it("collapses the base run into the run date and splits later merges out", () => {
    expect(
      scoringDates(
        [
          m("Base A", "2026-06-16"), // bulk price check before the run
          m("Base B", "2026-07-10"),
          m("Merged", "2026-07-24"),
        ],
        "2026-07-10",
      ),
    ).toEqual([
      { date: "2026-07-10", labels: ["Base A", "Base B"] },
      { date: "2026-07-24", labels: ["Merged"] },
    ]);
  });

  it("groups same-day merges together and keeps board order within a group", () => {
    const groups = scoringDates(
      [m("Higher", "2026-07-21"), m("Lower", "2026-07-21"), m("Base", null)],
      "2026-07-10",
    );
    expect(groups).toHaveLength(2);
    expect(groups[1]).toEqual({ date: "2026-07-21", labels: ["Higher", "Lower"] });
  });
});

describe("run prose", () => {
  const run = (scoringDates: { date: string; labels: string[] }[]): ShipSenseRunMeta => ({
    version: "v3.0",
    runId: scoringDates[0].date,
    bankItems: 67,
    modelCount: scoringDates.reduce((n, d) => n + d.labels.length, 0),
    naiveFloor: 39.1,
    decisivePairs: 1,
    totalPairs: 3,
    scoringDates,
  });

  it("reads a single-date run as one run, not a window", () => {
    const one = run([{ date: "2026-07-10", labels: ["A", "B"] }]);
    expect(scoredWindowLabel(one)).toBe("scored 2026-07-10");
    expect(describeScoringDates(one)).toContain("in a single run on 2026-07-10");
  });

  it("names small merge groups and counts large ones", () => {
    const many = run([
      { date: "2026-07-10", labels: ["A", "B", "C", "D"] },
      { date: "2026-07-21", labels: ["Gemini 3.6 Flash", "Gemini 3.5 Flash-Lite"] },
      { date: "2026-08-03", labels: ["Qwen 3.8 Max"] },
    ]);
    expect(scoredWindowLabel(many)).toBe("scored 2026-07-10 – 08-03");
    expect(describeScoringDates(many)).toBe(
      "The v3.0 board merges three scoring dates on the identical 67-item bank: " +
        "4 models on 2026-07-10, then Gemini 3.6 Flash with Gemini 3.5 Flash-Lite (07-21) " +
        "and Qwen 3.8 Max (08-03).",
    );
  });

  it("spells out the year when a run spans one", () => {
    expect(
      scoredWindowLabel(
        run([
          { date: "2026-12-20", labels: ["A"] },
          { date: "2027-01-06", labels: ["B"] },
        ]),
      ),
    ).toBe("scored 2026-12-20 – 2027-01-06");
  });

  it("titles an unmapped provider rather than dropping it", () => {
    expect(providerLabel("qwen")).toBe("Qwen");
    expect(providerLabel("xai")).toBe("xAI");
    expect(providerLabel("newlab")).toBe("Newlab");
  });
});

describe("committed snapshot invariants", () => {
  // Deliberately NOT pinned to a model count: the daily sync workflow commits
  // this snapshot unattended, so a new model upstream must not read as a test
  // failure. These assert internal consistency instead — the things that only
  // break if the derivation port breaks.
  it("splits every ranked model into exactly one of lineup or generations", () => {
    expect(SHIP_SENSE_LINEUP.length + SHIP_SENSE_GENERATIONS.length).toBe(
      SHIP_SENSE_RUN.modelCount,
    );
    expect(SHIP_SENSE_LINEUP.length).toBeGreaterThan(1);
  });

  it("pairs every ranked model against every other exactly once", () => {
    const n = SHIP_SENSE_RUN.modelCount;
    expect(SHIP_SENSE_RUN.totalPairs).toBe((n * (n - 1)) / 2);
    expect(SHIP_SENSE_RUN.decisivePairs).toBeLessThanOrEqual(SHIP_SENSE_RUN.totalPairs);
  });

  it("keeps every point score inside its own confidence interval", () => {
    SHIP_SENSE_LINEUP.forEach((m) => {
      expect(m.lo).toBeLessThanOrEqual(m.score);
      expect(m.score).toBeLessThanOrEqual(m.hi);
    });
  });

  it("retires each previous generation to a model still in the lineup", () => {
    const current = new Set(SHIP_SENSE_LINEUP.map((m) => m.label));
    SHIP_SENSE_GENERATIONS.forEach((g) => {
      expect(current.has(g.currLabel)).toBe(true);
      expect(current.has(g.prevLabel)).toBe(false);
    });
  });

  it("covers every ranked model with exactly one scoring date, starting at the run", () => {
    const { scoringDates, runId, modelCount } = SHIP_SENSE_RUN;
    expect(scoringDates[0].date).toBe(runId);
    const labels = scoringDates.flatMap((d) => d.labels);
    expect(labels).toHaveLength(modelCount);
    expect(new Set(labels).size).toBe(modelCount);
    scoringDates.forEach((d, i) => {
      if (i > 0) expect(d.date > scoringDates[i - 1].date).toBe(true);
    });
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
