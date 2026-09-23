import { ExternalLink } from "lucide-react";
import Surface from "@/components/Surface";
import SectionHeader from "@/components/SectionHeader";
import { controlPill } from "@/components/ControlPill";
import useHead from "@/hooks/useHead";
import {
  SHIP_SENSE_BOARD_URL,
  SHIP_SENSE_DESCRIPTION,
  SHIP_SENSE_DIMENSIONS,
  SHIP_SENSE_REPO_URL,
  SHIP_SENSE_VERDICT_TEXT,
  buildShipSenseJsonLd,
  describeScoringDates,
  pFirstText,
  providerLabel,
  rankRangeText,
  scoredWindowLabel,
  valueCalloutText,
  type ShipSenseGeneration,
  type ShipSenseRunMeta,
  type ShipSenseVerdict,
} from "@/data/ship-sense";
import {
  SHIP_SENSE_GENERATIONS,
  SHIP_SENSE_LINEUP,
  SHIP_SENSE_RUN,
} from "@/data/ship-sense-snapshot";

// Shared score axis for the interval strips — 70–95 by default, matching the
// canonical board's field plot. It only ever WIDENS, in 5-point steps, so a
// model the daily sync pulls in below 70 or above 95 still lands on the lane
// instead of overflowing it; the usual board keeps the exact ticks it had.
// The score floor (v4.0: 52.8 for the best content-free policy) is
// deliberately OFF this axis: stretching to include it would compress every
// interval into the right third and erase the differences the strips exist
// to show.
const axisFor = (rows: { lo: number; hi: number }[]) => {
  const lo = Math.min(70, ...rows.map((m) => m.lo));
  const hi = Math.max(95, ...rows.map((m) => m.hi));
  // Widen past ~40 points and 5-point ticks crowd the lane; step to 10 and
  // re-snap both bounds so the last tick still lands on AXIS_MAX.
  const step = hi - lo > 40 ? 10 : 5;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  return {
    min,
    max,
    ticks: Array.from({ length: (max - min) / step + 1 }, (_, i) => min + i * step),
  };
};

const { min: AXIS_MIN, max: AXIS_MAX, ticks: AXIS_TICKS } = axisFor(SHIP_SENSE_LINEUP);
const pct = (v: number) => ((v - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * 100;

const fmt1 = (n: number) => n.toFixed(1);
const fmt2 = (n: number) => n.toFixed(2);
const signed1 = (n: number) => `${n < 0 ? "-" : "+"}${Math.abs(n).toFixed(1)}`;
const price = (n: number) => `$${n}`;

const VERDICT_GLYPH: Record<ShipSenseVerdict, string> = {
  "decisive-up": "▲",
  "suggestive-up": "△",
  up: "△",
  even: "—",
  down: "▽",
  "suggestive-down": "▽",
  "decisive-down": "▼",
};

const HAS_RANK_SETS = SHIP_SENSE_LINEUP.some((m) => m.rankLo !== undefined);
const VALUE_CALLOUT = valueCalloutText(SHIP_SENSE_LINEUP);

// The current run's own successions, and — kept RTINGS-style below them — any
// prior bench version's successions the current run didn't re-measure. See
// ShipSenseGeneration.earlier.
const CURRENT_GENERATIONS = SHIP_SENSE_GENERATIONS.filter((g) => !g.earlier);
const EARLIER_GENERATIONS = SHIP_SENSE_GENERATIONS.filter((g) => g.earlier);

/** The floor sentence: every adversarial policy on v4.0+, else the naive
 * baseline of older runs. */
const floorText = (run: ShipSenseRunMeta): string => {
  if (run.floorKind === "naive" || run.floorRows.length === 0) {
    return `A naive "ship everything, flag nothing, always cave" baseline scores ${fmt1(run.floor)} — below this axis.`;
  }
  const others = run.floorRows
    .filter((f) => f.headline !== run.floor)
    .map((f) => `${f.label.toLowerCase()} ${fmt1(f.headline)}`);
  return (
    `Gameability floor: the best content-free answering policy, graded by the same grader, scores ${fmt1(run.floor)}` +
    `${others.length ? ` (${others.join(", ")})` : ""} — below this axis; a model near it is not exercising judgment.`
  );
};

/** How the decisive count was called, named by its test. */
const DECISIVE_RULE_TEXT: Record<ShipSenseRunMeta["decisiveRule"], string> = {
  bh: "at an exploratory Benjamini–Hochberg q ≤ 0.05",
  holm: "after Holm correction",
};

/** What made a succession verdict decisive, by its test family. */
const GENERATION_FAMILY_TEXT: Record<ShipSenseGeneration["family"], string> = {
  confirmatory:
    "significant after Holm correction within the pre-registered confirmatory family (successions and named vendor claims)",
  exploratory: "an exploratory Benjamini–Hochberg q ≤ 0.05",
  legacy: "significant after Holm correction across all pairs",
};

// Module-level so the JSON-LD object identity is stable and useHead's effect
// doesn't re-run every render (same pattern as ResearchIndex).
const BENCHMARK_JSON_LD = buildShipSenseJsonLd(SHIP_SENSE_RUN);

/** 95% CI band + point-score tick on the shared 70–95 lane. Decorative only:
 * the same numbers are rendered as text in the row. */
const IntervalStrip = ({ lo, hi, score }: { lo: number; hi: number; score: number }) => (
  <div className="relative h-3" aria-hidden="true">
    <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-track" />
    <div
      className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-text-tertiary"
      style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
    />
    <div
      className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
      style={{ left: `calc(${pct(score)}% - 1px)` }}
    />
  </div>
);

/** One succession row, shared by the current-bench list and the earlier-bench
 * list below it. `showBench` appends "tested on vX" — redundant on the
 * current list (the page header already names the run's version), needed on
 * the earlier one so each row still says which bench it was measured on once
 * it's out from under its own group label. */
const GenerationRow = ({ g, showBench }: { g: ShipSenseGeneration; showBench?: boolean }) => {
  const decisive = g.verdict === "decisive-up" || g.verdict === "decisive-down";
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <p className="text-body text-text-secondary">
        {g.prevLabel} {fmt1(g.prevScore)}
        <span className="mx-2 text-text-tertiary">→</span>
        <span className="text-foreground">
          {g.currLabel} {fmt1(g.currScore)}
        </span>
      </p>
      <p className="text-meta text-text-tertiary">
        <span className={decisive ? "font-semibold text-foreground" : undefined}>
          {VERDICT_GLYPH[g.verdict]} {signed1(g.deltaPts)}
        </span>{" "}
        [{signed1(g.loPts)}, {signed1(g.hiPts)}] · {SHIP_SENSE_VERDICT_TEXT[g.verdict]}
        {showBench ? ` · tested on ${g.bench}` : ""}
      </p>
    </li>
  );
};

const Benchmark = () => {
  const run = SHIP_SENSE_RUN;
  const scoredWindow = scoredWindowLabel(run);
  const anyRepriced = SHIP_SENSE_LINEUP.some((m) => m.atTestPriceIn !== undefined);
  const anyPending = SHIP_SENSE_LINEUP.some((m) => m.pendingEffective !== undefined);

  useHead({
    title: "Ship Sense Benchmark — LLM Vibes",
    description: SHIP_SENSE_DESCRIPTION,
    url: "/benchmark",
    ogImage: "/benchmark/og.png",
    jsonLd: BENCHMARK_JSON_LD,
  });

  return (
    <>
      <section className="container pb-8 pt-10 sm:pt-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-mono-cap text-text-tertiary">
              {run.version} · {run.bankItems}-item bank · {SHIP_SENSE_LINEUP.length} current models ·{" "}
              {scoredWindow}
            </p>
            <h1 className="mt-2 text-page text-foreground">Ship Sense</h1>
            <p className="mt-2 max-w-2xl text-body text-text-secondary">
              A benchmark of product judgment under uncertainty. Most evals reward a
              model for producing more — Ship Sense tests whether it knows when to
              stop: what not to build, what evidence cannot establish, and when
              pressure should not change a decision.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <a
              href={SHIP_SENSE_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={controlPill("group")}
            >
              GitHub
              <ExternalLink className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </a>
            <a
              href={SHIP_SENSE_BOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={controlPill("group")}
            >
              Live board
              <ExternalLink className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <section className="container pb-12">
        <Surface as="div" size="default" elevation="card">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-section text-foreground">Current lineup</h2>
            <p className="text-mono-cap text-text-tertiary">
              Score · 95% CI
            </p>
          </div>
          {/* Shared-axis header for the strips (strips are inset by the rank
              gutter, ml-8, so the tick row inherits the same inset). */}
          <div className="ml-8 mt-4" aria-hidden="true">
            <div className="relative h-4 text-meta text-text-tertiary">
              {AXIS_TICKS.map((t) => (
                <span
                  key={t}
                  className="absolute"
                  style={{
                    left: `${pct(t)}%`,
                    transform:
                      t === AXIS_MIN
                        ? undefined
                        : t === AXIS_MAX
                          ? "translateX(-100%)"
                          : "translateX(-50%)",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
          <ul className="mt-1 divide-y divide-border">
            {SHIP_SENSE_LINEUP.map((m) => (
              <li key={m.name} className="py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-body text-foreground">
                    <span className="mr-2 inline-block w-6 text-meta text-text-tertiary">
                      {m.pos}
                    </span>
                    {m.label}
                  </p>
                  <p className="shrink-0 text-meta font-semibold text-foreground">
                    {fmt1(m.score)}{" "}
                    <span className="font-normal text-text-tertiary">
                      [{fmt1(m.lo)}–{fmt1(m.hi)}]
                    </span>
                  </p>
                </div>
                <div className="ml-8 mt-2">
                  <IntervalStrip lo={m.lo} hi={m.hi} score={m.score} />
                </div>
                <p className="ml-8 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-text-tertiary">
                  <span>
                    {providerLabel(m.provider)} · tested on {m.testedOn}
                  </span>
                  {HAS_RANK_SETS ? (
                    <span title="95% rank confidence set from the paired tests; P(#1) = share of joint item-bootstrap resamples in which this model scores highest">
                      Rank range {rankRangeText(m)} · P(#1) {pFirstText(m)}
                    </span>
                  ) : null}
                  <span
                    title={
                      m.atTestPriceIn !== undefined
                        ? `Scored at ${price(m.atTestPriceIn)} / ${price(m.atTestPriceOut!)} per 1M tokens`
                        : undefined
                    }
                  >
                    {price(m.priceIn)} / {price(m.priceOut)} per 1M
                    {m.atTestPriceIn !== undefined ? " †" : ""}
                    {m.pendingEffective !== undefined ? (
                      <span
                        title={`Announced: ${price(m.pendingPriceIn!)} / ${price(m.pendingPriceOut!)} per 1M from ${m.pendingEffective}`}
                      >
                        {" ‡"}
                      </span>
                    ) : null}
                  </span>
                  <span>
                    R {fmt2(m.restraint)} · H {fmt2(m.honesty)} · C{" "}
                    {fmt2(m.conviction)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-1 border-t border-border pt-4 text-meta text-text-tertiary">
            <p>
              # = order by point score. Band and tick: 95% confidence interval and
              point score from an item-clustered bootstrap.
              {HAS_RANK_SETS
                ? " Rank range = the ranks a model's Holm-corrected paired tests against the current lineup cannot rule out (95%). P(#1) = share of item resamples in which it scores highest — descriptive, not a test."
                : ""}
            </p>
            <p>
              {floorText(run)} R / H / C = Restraint, Honesty, Conviction (0–1).
              Prices are current list per 1M input/output tokens
              {anyRepriced ? "; † list price moved since the run (at-test price on hover)" : ""}
              {anyPending ? "; ‡ announced list price change (new rate and date on hover)" : ""}.
            </p>
            <p>
              Point scores rank; paired tests separate: {run.decisivePairs} of{" "}
              {run.totalPairs} paired comparisons (current and previous generations)
              are decisive {DECISIVE_RULE_TEXT[run.decisiveRule]}.
            </p>
            {VALUE_CALLOUT ? (
              <p>
                <span className="font-semibold text-text-secondary">Choosing a model?</span>{" "}
                {VALUE_CALLOUT}
              </p>
            ) : null}
          </div>
        </Surface>
      </section>

      <section className="container pb-12">
        <SectionHeader title="What it measures" className="mb-4" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {SHIP_SENSE_DIMENSIONS.map((d) => (
            <Surface as="article" key={d.name}>
              <h3 className="text-section text-foreground">{d.name}</h3>
              <p className="mt-2 text-body text-text-secondary">{d.question}</p>
              <p className="mt-3 text-meta text-text-tertiary">{d.grading}</p>
            </Surface>
          ))}
        </div>
      </section>

      <section className="container pb-12">
        <SectionHeader
          title="Current vs. previous generations"
          meta="Paired on the same items"
          className="mb-4"
        />
        <Surface>
          <ul className="divide-y divide-border">
            {CURRENT_GENERATIONS.map((g) => (
              <GenerationRow key={`${g.prevLabel}-${g.currLabel}`} g={g} />
            ))}
          </ul>
          {EARLIER_GENERATIONS.length > 0 ? (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-mono-cap text-text-tertiary">
                Earlier bench ({EARLIER_GENERATIONS[0].bench})
              </p>
              <ul className="mt-2 divide-y divide-border">
                {EARLIER_GENERATIONS.map((g) => (
                  <GenerationRow key={`${g.prevLabel}-${g.currLabel}`} g={g} showBench />
                ))}
              </ul>
              <p className="mt-2 text-meta text-text-tertiary">
                Scores are comparable only within a bench version: {EARLIER_GENERATIONS[0].bench}{" "}
                used a different bank and grader than {run.version}, so a {EARLIER_GENERATIONS[0].bench}{" "}
                score is never set against a {run.version} score.
              </p>
            </div>
          ) : null}
          <p className="mt-4 border-t border-border pt-4 text-meta text-text-tertiary">
            Δ = paired score difference in board points (current − previous) on the
            same items. Decisive ={" "}
            {joinFamilies(SHIP_SENSE_GENERATIONS)}; slight = which way a
            not-significant gap leans. When a lab ships a direct successor, the
            outgoing model retires here automatically — the upgrade claim is
            decided by the paired test, not the launch post.
          </p>
        </Surface>
      </section>

      <section className="container pb-16">
        <SectionHeader title="Method & provenance" className="mb-4" />
        <div className="max-w-3xl space-y-4 text-body text-text-secondary">
          <p>
            The answer keys come from decisions David Kelly documented across ten
            years and five companies (2016–2026): a lifetime-deal software
            portfolio run as GM, an agentic creator product, a paid newsletter, an
            F&amp;B subscription marketplace, and a fintech marketplace. Every
            official item maps to a private source artifact — PRDs, launch
            post-mortems, pricing models, founder email threads — and a key enters
            the bank only after verification against the decision recorded at the
            time. The scored cases stay private; the harness, grading, and
            statistics are open.
          </p>
          <p>
            {describeScoringDates(run)} The Ship Sense Score is the equal-weight
            mean of the three dimensions, with a 95% confidence interval from an
            item-clustered bootstrap. Grading is deterministic key-matching, not
            an LLM judge, and every model runs at its shipped API defaults.
            Successions and named launch claims form a small confirmatory family
            registered before any answer was collected and Holm-corrected within
            itself; every other pair is exploratory, reported with a
            Benjamini–Hochberg q-value. Every row names the Ship Sense version
            that scored it, and scores compare only within a version.
          </p>
          <p>
            This is one product leader's documented judgment, not an industry
            standard: the keys have no independent human rater yet (the September
            2026 audits were automated second readings, not a second human), and
            the bank measures three behaviors — not discovery, design judgment,
            rollout, or organizational leadership. Grading detail is in{" "}
            <BenchmarkDocLink path="RUBRICS.md" />, design and limitations in{" "}
            <BenchmarkDocLink path="METHODOLOGY.md" />, every defect the
            self-audits have found and what each one moved in{" "}
            <BenchmarkDocLink path="FINDINGS.md" />, and the September 2026 audits
            behind v4.0 in <BenchmarkDocLink path="CORRECTIONS.md" />. The full
            win/loss matrix is
            on the{" "}
            <a
              href={`${SHIP_SENSE_BOARD_URL}#headtohead`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-secondary underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              live leaderboard
            </a>
            .
          </p>
        </div>
      </section>
    </>
  );
};

/** Decisive-rule wording for every family present in the table, in order. */
const joinFamilies = (gens: ShipSenseGeneration[]): string =>
  [...new Set(gens.map((g) => g.family))].map((f) => GENERATION_FAMILY_TEXT[f]).join("; or ");

const BenchmarkDocLink = ({ path }: { path: string }) => (
  <a
    href={`${SHIP_SENSE_REPO_URL}/blob/main/${path}`}
    target="_blank"
    rel="noopener noreferrer"
    className="text-text-secondary underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
  >
    {path}
  </a>
);

export default Benchmark;
