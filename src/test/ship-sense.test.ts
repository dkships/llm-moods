import { describe, expect, it } from "vitest";
import {
  decisiveRule,
  floorValue,
  generationPairsFromSuccessions,
  holmAdjust,
  lineage,
  matrixWinner,
  orientPair,
  parsePairwise,
  parseModelsYaml,
  previousBenchSnapshot,
  rankSets,
  scoringDates,
  successions,
  type DeriveModel,
  type DerivePairRecord,
  type LedgerRun,
} from "../../scripts/ship-sense-derive";
import {
  describeScoringDates,
  pFirstText,
  providerLabel,
  rankRangeText,
  scoredWindowLabel,
  valueCalloutText,
  type ShipSenseModelRow,
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
    expect(lineage("MiniMax M3")).toEqual({ family: "minimax", version: [3] });
    expect(lineage("DeepSeek V4 Pro")).toEqual({ family: "deepseek pro", version: [4] });
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

  it("pairs a retired model with its NEAREST ranked successor", () => {
    const models = [
      model("grok-4.3", "Grok 4.3", 80, 75, 85),
      model("grok-4.5", "Grok 4.5", 82, 77, 87),
      model("grok-4.6", "Grok 4.6", 83, 78, 88),
    ];
    const succ = successions(models, new Map());
    expect(succ.get("grok-4.3")).toBe("grok-4.5");
    expect(succ.get("grok-4.5")).toBe("grok-4.6");
  });

  it("never retires on the strength of an unranked successor", () => {
    const models = [
      model("a-1", "Thing 1", 80, 75, 85),
      model("a-2", "Thing 2", 82, 77, 87, { ranked_eligible: false }),
    ];
    expect(successions(models, new Map()).size).toBe(0);
  });
});

describe("rank sets", () => {
  const rec = (a: string, b: string, delta: number, p_value: number): DerivePairRecord => ({
    a,
    b,
    delta,
    lo: 0,
    hi: 0,
    holm_p: null,
    winner: null,
    p_value,
    q_value: p_value,
    family: "exploratory",
  });

  it("holmAdjust matches stats.holm_adjust (step-down, monotone, capped at 1)", () => {
    expect(holmAdjust([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06]);
    expect(holmAdjust([0.5, 0.6])).toEqual([1, 1]);
  });

  it("builds [1 + beaten by, N − beats] from each model's own Holm family", () => {
    // a beats c decisively (0.001 × 2 = 0.002); everything else is noise.
    const sets = rankSets(
      ["a", "b", "c"],
      [rec("a", "b", 0.01, 0.4), rec("a", "c", 0.05, 0.001), rec("c", "b", -0.01, 0.5)],
    );
    expect(sets.get("a")).toEqual({ lo: 1, hi: 2 });
    expect(sets.get("b")).toEqual({ lo: 1, hi: 3 });
    expect(sets.get("c")).toEqual({ lo: 2, hi: 3 });
  });

  it("ignores pairs outside the lineup (retired predecessors)", () => {
    const sets = rankSets(
      ["a", "b"],
      [rec("a", "b", 0.01, 0.4), rec("a", "old", 0.2, 0.0001)],
    );
    expect(sets.get("a")).toEqual({ lo: 1, hi: 2 });
  });

  it("returns no ranges when a lineup pair or raw p-value is missing", () => {
    expect(rankSets(["a", "b", "c"], [rec("a", "b", 0.01, 0.4)]).size).toBe(0);
    const legacy = { a: "a", b: "b", delta: 0.1, lo: 0, hi: 0.2, holm_p: 0.01, winner: "a" };
    expect(rankSets(["a", "b"], [legacy]).size).toBe(0);
  });
});

describe("pairwise bundle", () => {
  const legacy = { a: "x", b: "y", delta: 0.1, lo: 0.02, hi: 0.2, holm_p: 0.01, winner: "x" };

  it("accepts the pre-v4.0 bare list", () => {
    const bundle = parsePairwise([legacy]);
    expect(bundle.records).toHaveLength(1);
    expect(bundle.pFirst).toEqual({});
    expect(decisiveRule(bundle.records)).toBe("holm");
    expect(matrixWinner(bundle.records[0])).toBe("x");
  });

  it("accepts the v4.0 {record_schema, records, p_first} shape", () => {
    const record = {
      ...legacy,
      holm_p: null,
      winner: "x",
      winner_exploratory: null,
      p_value: 0.04,
      q_value: 0.2,
      family: "exploratory",
    };
    const bundle = parsePairwise({ record_schema: 2, records: [record], p_first: { x: 0.7 } });
    expect(bundle.pFirst).toEqual({ x: 0.7 });
    expect(decisiveRule(bundle.records)).toBe("bh");
    // The matrix calls decisive on the BH verdict, not the family winner.
    expect(matrixWinner(bundle.records[0])).toBeNull();
  });

  it("rejects anything else", () => {
    expect(() => parsePairwise({ comparisons: [] })).toThrow();
  });
});

describe("floorValue", () => {
  it("prefers the best adversarial policy when the run carries one", () => {
    const rows = [
      { label: "Best adversarial policy", headline: 52.7671, restraint: 0.45, honesty: 0.49, conviction: 0.65 },
      { label: "Random policy", headline: 43.41, restraint: 0.34, honesty: 0.42, conviction: 0.55 },
    ];
    expect(floorValue({ naive_floor: null, adversarial_floor: rows })).toEqual({
      value: 52.7671,
      kind: "adversarial",
    });
  });

  it("falls back to the naive floor on older runs", () => {
    expect(floorValue({ naive_floor: 39.2 })).toEqual({ value: 39.2, kind: "naive" });
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

  it("carries the record's family (legacy when absent)", () => {
    expect(orientPair(rec, "claude-sonnet-4-6", "claude-sonnet-5")!.family).toBe("legacy");
    expect(
      orientPair({ ...rec, family: "confirmatory" }, "claude-sonnet-4-6", "claude-sonnet-5")!
        .family,
    ).toBe("confirmatory");
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

describe("previousBenchSnapshot", () => {
  const run = (version: string): LedgerRun => ({ run_id: version, version, models: [] });

  it("picks the newest run whose version differs from the latest run's", () => {
    const runs = [run("v3.0"), run("v3.6"), run("v3.6"), run("v4.0")];
    expect(previousBenchSnapshot(runs)?.version).toBe("v3.6");
  });

  it("returns null when every earlier run shares the latest version", () => {
    expect(previousBenchSnapshot([run("v4.0"), run("v4.0")])).toBeNull();
  });

  it("returns null with no earlier run at all", () => {
    expect(previousBenchSnapshot([run("v1.0")])).toBeNull();
    expect(previousBenchSnapshot([])).toBeNull();
  });
});

describe("generationPairsFromSuccessions", () => {
  const rec = (a: string, b: string, delta: number, winner: string | null): DerivePairRecord => ({
    a,
    b,
    delta,
    lo: delta - 0.02,
    hi: delta + 0.02,
    holm_p: winner ? 0.001 : 1,
    winner,
  });

  it("builds one entry per succession with a published record, sorted by delta desc", () => {
    const models = [
      model("a-1", "A 1", 80, 76, 84),
      model("a-2", "A 2", 88, 84, 92),
      model("b-1", "B 1", 70, 66, 74),
      model("b-2", "B 2", 71, 67, 75),
    ];
    const succ = new Map([
      ["a-1", "a-2"],
      ["b-1", "b-2"],
    ]);
    const records = [rec("a-2", "a-1", 0.08, "a-2"), rec("b-2", "b-1", 0.01, null)];
    const pairs = generationPairsFromSuccessions(models, succ, records);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ prevLabel: "A 1", currLabel: "A 2", verdict: "decisive-up" });
    expect(pairs[1]).toMatchObject({ prevLabel: "B 1", currLabel: "B 2", verdict: "up" });
  });

  it("drops a succession with no published record instead of failing", () => {
    const models = [model("a-1", "A 1", 80, 76, 84), model("a-2", "A 2", 88, 84, 92)];
    const pairs = generationPairsFromSuccessions(models, new Map([["a-1", "a-2"]]), []);
    expect(pairs).toEqual([]);
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

describe("parseModelsYaml", () => {
  // Indentation is load-bearing: entries at 2, fields at 4, nested at 6.
  const yaml = `defaults:
  timeout_s: 600

models:
  - name: gemini-3.7-flash
    provider: google
    label: "Gemini 3.7 Flash"
    price_in: 0.75               # introductory, reverts 2027-01-01
    price_out: 3.75
    price_pending:
      effective: "2027-01-01"
      price_in: 1.5
      price_out: 7.5
      source: "https://ai.google.dev/gemini-api/docs/pricing"
  - name: gpt-5.5
    label: "GPT-5.5"
    price_in: 5
    price_out: 30
    superseded_by: gpt-5.6-sol

scoring:
  mde_pp: 15
`;

  it("reads labels, prices and explicit successions", () => {
    const registry = parseModelsYaml(yaml);
    expect(registry.get("gpt-5.5")).toEqual({
      label: "GPT-5.5",
      priceIn: 5,
      priceOut: 30,
      supersededBy: "gpt-5.6-sol",
    });
  });

  it("reads a nested price_pending block", () => {
    expect(parseModelsYaml(yaml).get("gemini-3.7-flash")?.pending).toEqual({
      effective: "2027-01-01",
      priceIn: 1.5,
      priceOut: 7.5,
    });
  });

  it("stops at the end of the models list", () => {
    const registry = parseModelsYaml(yaml);
    expect(registry.size).toBe(2);
    expect(registry.has("mde_pp")).toBe(false);
  });

  it("does not let a sibling nested block overwrite the model's own price", () => {
    // The shape ship-sense uses for a model that bills on a clock: the cell
    // takes the peak rate and off-peak sits in its own block. Its `price_in`
    // is six-space indented and must never be read as the model's price.
    const withOffpeak = `models:
  - name: deepseek-v4-pro
    label: "DeepSeek V4 Pro"
    price_in: 1.32
    price_out: 3.96
    price_offpeak:
      price_in: 0.66
      price_out: 1.98
      note: "off-peak = half of peak"
`;
    expect(parseModelsYaml(withOffpeak).get("deepseek-v4-pro")).toEqual({
      label: "DeepSeek V4 Pro",
      priceIn: 1.32,
      priceOut: 3.96,
    });
  });

  it("survives a comment inside the pending block", () => {
    const commented = `models:
  - name: a
    price_in: 1
    price_out: 2
    price_pending:
      effective: "2027-01-01"
      # the vendor announced this on the pricing page
      price_in: 3
      price_out: 4
`;
    expect(parseModelsYaml(commented).get("a")?.pending?.priceOut).toBe(4);
  });

  it("drops a half-filled pending block rather than publishing a bare date", () => {
    const halfFilled = `models:
  - name: a
    price_in: 1
    price_out: 2
    price_pending:
      effective: "2027-01-01"
      source: "https://example.com"
`;
    expect(parseModelsYaml(halfFilled).get("a")?.pending).toBeUndefined();
  });
});

describe("run prose", () => {
  const run = (scoringDates: { date: string; labels: string[] }[]): ShipSenseRunMeta => ({
    version: "v3.0",
    runId: scoringDates[0].date,
    runDate: scoringDates[0].date,
    bankItems: 67,
    modelCount: scoringDates.reduce((n, d) => n + d.labels.length, 0),
    floor: 39.1,
    floorKind: "naive",
    floorRows: [],
    decisiveRule: "holm",
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
    expect(providerLabel("minimax")).toBe("MiniMax");
  });
});

describe("rank range and value callout", () => {
  const row = (
    name: string,
    priceIn: number,
    priceOut: number,
    rankLo?: number,
  ): ShipSenseModelRow => ({
    name,
    label: name.toUpperCase(),
    provider: "x",
    pos: 1,
    rankLo,
    rankHi: rankLo === undefined ? undefined : 6,
    testedOn: "v4.0",
    score: 80,
    lo: 78,
    hi: 82,
    restraint: 0.8,
    honesty: 0.8,
    conviction: 0.8,
    priceIn,
    priceOut,
  });

  it("formats rank ranges and P(#1) like the upstream board", () => {
    expect(rankRangeText({ rankLo: 1, rankHi: 6 })).toBe("1–6");
    expect(rankRangeText({ rankLo: 3, rankHi: 3 })).toBe("3");
    expect(rankRangeText({})).toBe("—");
    expect(pFirstText({ pFirst: 0.6298 })).toBe("63%");
    expect(pFirstText({})).toBe("—");
  });

  it("names the cheapest and every tied priciest #1 contender", () => {
    const text = valueCalloutText([
      row("a", 4, 20, 1),
      row("b", 10, 50, 1),
      row("c", 1.25, 4.25, 1),
      row("d", 10, 50, 1),
      row("e", 0.1, 0.5, 6),
    ]);
    expect(text).toContain("C is the least expensive model whose rank range includes #1, at $1.25/$4.25");
    expect(text).toContain("B and D are the most expensive at $10/$50");
  });

  it("stays silent with fewer than two contenders or no rank sets", () => {
    expect(valueCalloutText([row("a", 4, 20, 1), row("b", 1, 2, 2)])).toBeNull();
    expect(valueCalloutText([row("a", 4, 20), row("b", 1, 2)])).toBeNull();
  });
});

describe("committed snapshot invariants", () => {
  // Deliberately NOT pinned to a model count: the daily sync workflow commits
  // this snapshot unattended, so a new model upstream must not read as a test
  // failure. These assert internal consistency instead — the things that only
  // break if the derivation port breaks.
  it("splits every ranked model into exactly one of lineup or generations", () => {
    // Only the latest run's own successions count toward its model count —
    // an earlier bench version's kept-alive successions (g.earlier) describe
    // a different run entirely and are not part of this one's roster.
    const latest = SHIP_SENSE_GENERATIONS.filter((g) => !g.earlier);
    expect(SHIP_SENSE_LINEUP.length + latest.length).toBe(SHIP_SENSE_RUN.modelCount);
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

  it("retires each latest-bench generation to a model still in the lineup", () => {
    // An earlier bench's successor need not hold a rank on today's board (it
    // may itself have been retired since) — this invariant is about the
    // latest run's own successions only.
    const current = new Set(SHIP_SENSE_LINEUP.map((m) => m.label));
    SHIP_SENSE_GENERATIONS.filter((g) => !g.earlier).forEach((g) => {
      expect(current.has(g.currLabel)).toBe(true);
      expect(current.has(g.prevLabel)).toBe(false);
    });
  });

  it("tags every generation with the bench version that measured it", () => {
    SHIP_SENSE_GENERATIONS.forEach((g) => {
      expect(g.bench).toMatch(/^v\d/);
      expect(g.earlier).toBe(g.bench !== SHIP_SENSE_RUN.version);
    });
  });

  it("covers every ranked model with exactly one scoring date, starting at the run", () => {
    const { scoringDates, runDate, modelCount } = SHIP_SENSE_RUN;
    expect(scoringDates[0].date).toBe(runDate);
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

  it("carries a complete rate and date on every announced price change", () => {
    // Asserts shape, not presence: some syncs have no pending change at all,
    // and the page must never render half a notice.
    SHIP_SENSE_LINEUP.filter((m) => m.pendingEffective !== undefined).forEach((m) => {
      expect(m.pendingEffective).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof m.pendingPriceIn).toBe("number");
      expect(typeof m.pendingPriceOut).toBe("number");
    });
  });

  it("keeps every rank range inside the lineup and around its own position's reach", () => {
    const n = SHIP_SENSE_LINEUP.length;
    SHIP_SENSE_LINEUP.filter((m) => m.rankLo !== undefined).forEach((m) => {
      expect(m.rankLo).toBeGreaterThanOrEqual(1);
      expect(m.rankLo!).toBeLessThanOrEqual(m.rankHi!);
      expect(m.rankHi).toBeLessThanOrEqual(n);
    });
    // The point leader can always still be #1.
    if (SHIP_SENSE_LINEUP[0].rankLo !== undefined) expect(SHIP_SENSE_LINEUP[0].rankLo).toBe(1);
  });

  it("keeps P(#1) a share that sums to about one over the lineup", () => {
    const shares = SHIP_SENSE_LINEUP.map((m) => m.pFirst).filter((p) => p !== undefined);
    if (shares.length === 0) return;
    expect(shares.reduce((a, b) => a + b!, 0)).toBeCloseTo(1, 2);
  });

  it("names the version that scored every row and a floor under the lineup", () => {
    SHIP_SENSE_LINEUP.forEach((m) => expect(m.testedOn).toMatch(/^v\d/));
    expect(SHIP_SENSE_RUN.floor).toBeLessThan(SHIP_SENSE_LINEUP[SHIP_SENSE_LINEUP.length - 1].score);
  });
});
