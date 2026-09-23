/**
 * Sync the Ship Sense benchmark snapshot from github.com/dkships/ship-sense.
 *
 * Runs unattended: `.github/workflows/sync-ship-sense.yml` calls this daily
 * and pushes the regenerated snapshot to main, so a model added upstream
 * reaches /benchmark without a hand edit. `npm run sync:shipsense` does the
 * same thing locally.
 *
 * Everything the page renders is derived here — including the scoring-window
 * and provenance prose, which used to be hand-copied from the ship-sense
 * README. Nothing downstream is pinned to a model count.
 *
 * Fetches leaderboard.json (scores), models.yaml (current prices + explicit
 * successions), docs/pairwise.json (paired head-to-head records + P(#1)), and
 * docs/card.png (OG image), then ports the board-composition logic from
 * ship-sense/src/leaderboard.py:
 *   - successions(): label-lineage inference (a ranked line-mate with a higher
 *     version retires a model, paired to its NEAREST ranked successor) with
 *     explicit `superseded_by` overriding — `ranked_eligible`/`coverage_status`
 *     do NOT distinguish retired models.
 *   - attach_rank_sets(): per-model 95% rank confidence sets from each model's
 *     Holm-corrected paired tests against the current lineup (v4.0+; replaces
 *     the v3.x leader-overlap band). P(#1) is read from pairwise.json, never
 *     re-derived — it needs the item-level bootstrap.
 *   - floor_value(): the adversarial gameability floor (v4.0+), else the naive
 *     floor of older runs.
 *   - _generation_pairs(): pairwise records are stored in arbitrary
 *     orientation on a 0–1 scale — normalize to (current − previous) × 100
 *     and swap-negate the CI bounds when flipping.
 *
 * Flags:
 *   --summary <path>  write a JSON change report (what moved vs. the committed
 *                     snapshot) for the workflow to turn into a commit message.
 *   --dry-run         derive and report, write nothing.
 *   --local <dir>     read the files from a local ship-sense checkout instead
 *                     of GitHub raw (e.g. to preview an unpublished run).
 *
 * Env: SHIP_SENSE_RAW overrides the GitHub raw base URL; a file:// URL reads
 * from disk, same as --local.
 */

import { join, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  decisiveRule,
  floorValue,
  matrixWinner,
  orientPair,
  parseModelsYaml,
  parsePairwise,
  rankSets,
  scoringDates,
  successions,
  type FloorRow,
} from "./ship-sense-derive";

const GITHUB_RAW = "https://raw.githubusercontent.com/dkships/ship-sense/main";
const ROOT = join(import.meta.dirname ?? __dirname, "..");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const summaryIndex = argv.indexOf("--summary");
const summaryPath = summaryIndex === -1 ? null : argv[summaryIndex + 1];
if (summaryIndex !== -1 && !summaryPath) throw new Error("[sync-ship-sense] --summary needs a path");
const localIndex = argv.indexOf("--local");
const localDir = localIndex === -1 ? null : argv[localIndex + 1];
if (localIndex !== -1 && !localDir) throw new Error("[sync-ship-sense] --local needs a directory");

// Where the files come from: --local beats SHIP_SENSE_RAW beats GitHub.
const RAW = localDir
  ? pathToFileURL(resolve(localDir)).href
  : (process.env.SHIP_SENSE_RAW ?? GITHUB_RAW).replace(/\/$/, "");
const LOCAL_ROOT = RAW.startsWith("file://") ? fileURLToPath(RAW) : null;

interface Score {
  value: number;
  lo: number;
  hi: number;
}

interface RunModel {
  name: string;
  label: string;
  provider: string;
  price_in: number | null;
  price_out: number | null;
  price_verified?: string | null;
  bench_version?: string | null;
  is_baseline: boolean;
  ranked_eligible?: boolean;
  superseded_by?: string | null;
  score: Score;
  restraint: Score;
  honesty: Score;
  conviction: Score;
}

const fail = (msg: string): never => {
  throw new Error(`[sync-ship-sense] ${msg}`);
};

async function fetchText(path: string): Promise<string> {
  if (LOCAL_ROOT) {
    return readFileSync(join(LOCAL_ROOT, path), "utf8");
  }
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) fail(`GET ${path} -> ${res.status}`);
  return res.text();
}

async function fetchBinary(path: string): Promise<Buffer> {
  if (LOCAL_ROOT) {
    return readFileSync(join(LOCAL_ROOT, path));
  }
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) fail(`GET ${path} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const r1 = (x: number) => Number(x.toFixed(1));
const r2 = (x: number) => Number(x.toFixed(2));

async function main() {
  const [leaderboardText, modelsYamlText, pairwiseText] = await Promise.all([
    fetchText("leaderboard.json"),
    fetchText("models.yaml"),
    fetchText("docs/pairwise.json"),
  ]);

  const ledger = JSON.parse(leaderboardText);
  const run = ledger.runs[ledger.runs.length - 1];
  const models: RunModel[] = run.models;
  const registry = parseModelsYaml(modelsYamlText);
  if (registry.size === 0) fail("models.yaml scanner matched no entries");
  const { records: pairwise, pFirst } = parsePairwise(JSON.parse(pairwiseText));

  const rankedModels = models.filter(
    (m) => !m.is_baseline && (m.ranked_eligible ?? true),
  );

  // Pairwise integrity: no run_id in the file, so verify it matches this run
  // by shape. Upstream publishes one record per pair of RANKED models in the
  // latest run — merged-in models and retired predecessors included (v4.0:
  // C(20,2) = 190, current lineup of 19 plus GPT-5.6 Sol) — so that is the
  // count, not C(current lineup, 2).
  const expectedPairs = (rankedModels.length * (rankedModels.length - 1)) / 2;
  if (pairwise.length !== expectedPairs)
    fail(`pairwise.json has ${pairwise.length} rows, expected C(${rankedModels.length},2)=${expectedPairs} — stale docs build?`);
  const runNames = new Set(models.map((m) => m.name));
  for (const rec of pairwise)
    if (!runNames.has(rec.a) || !runNames.has(rec.b))
      fail(`pairwise row ${rec.a}/${rec.b} references a model not in run ${run.run_id}`);

  const declared = new Map(
    [...registry]
      .filter(([, entry]) => entry.supersededBy)
      .map(([name, entry]) => [name, entry.supersededBy!]),
  );
  const succ = successions(models, declared);
  const current = rankedModels
    .filter((m) => !succ.has(m.name))
    .sort((a, b) => b.score.value - a.score.value);
  const previous = models
    .filter((m) => succ.has(m.name))
    .sort((a, b) => b.score.value - a.score.value);

  // Rank sets over the CURRENT lineup only (attach_rank_sets); legacy
  // pairwise files carry no raw p-values and yield no ranges.
  const ranks = rankSets(
    current.map((m) => m.name),
    pairwise,
  );
  const hasRankSets = ranks.size > 0;
  const rule = decisiveRule(pairwise);

  // Structural invariants, not pinned counts. The old fail-loud EXPECTED block
  // pinned lineup/generations/pairs to one official run, which blocked exactly
  // the case this sync now has to handle unattended: upstream added a model.
  // These checks still catch a broken derivation port — they just don't
  // mistake "ship-sense scored a new model" for a bug.
  if (current.length + previous.length !== rankedModels.length)
    fail(
      `lineage split lost models: ${current.length} current + ${previous.length} retired != ${rankedModels.length} ranked`,
    );
  if (current.length < 2)
    fail(`derived only ${current.length} current model(s) — successions() is over-retiring`);
  for (const [prev, curr] of succ)
    if (!current.some((m) => m.name === curr))
      fail(`${prev} retires to ${curr}, which is not in the current lineup`);
  for (const m of rankedModels)
    if (!(m.score.lo <= m.score.value && m.score.value <= m.score.hi))
      fail(`${m.name} score ${m.score.value} outside its CI [${m.score.lo}, ${m.score.hi}]`);
  if (rule === "bh" && !hasRankSets)
    fail("pairwise records carry q-values but rank sets could not be built — missing lineup pair or p_value");
  for (const [name, set] of ranks)
    if (!(1 <= set.lo && set.lo <= set.hi && set.hi <= current.length))
      fail(`${name} rank set ${set.lo}–${set.hi} is outside 1–${current.length}`);
  // P(#1) is computed upstream over the current lineup; a name outside it
  // means the two sides disagree on who is current (a successions drift).
  const currentNames = new Set(current.map((m) => m.name));
  for (const name of Object.keys(pFirst))
    if (!currentNames.has(name))
      fail(`pairwise.json p_first names ${name}, which this sync did not put in the current lineup`);

  // Scoring-date reconstruction — see scoringDates(). Board order so the
  // generated prose names models the way the page ranks them. Clamped to the
  // run DATE (run ids carry a version suffix since v3.6).
  const runDate: string = run.run_date ?? run.run_id;
  const dates = scoringDates([...current, ...previous], runDate);
  if (dates[0]?.date !== runDate)
    fail(`earliest scoring date ${dates[0]?.date} is not the run date ${runDate}`);
  const dated = dates.reduce((n, d) => n + d.labels.length, 0);
  if (dated !== rankedModels.length)
    fail(`scoring dates cover ${dated} models, expected ${rankedModels.length}`);

  const lineup = current.map((m, i) => {
    const reg = registry.get(m.name) ?? {};
    const priceIn = reg.priceIn ?? m.price_in ?? 0;
    const priceOut = reg.priceOut ?? m.price_out ?? 0;
    const repriced =
      m.price_in !== null &&
      m.price_out !== null &&
      (priceIn !== m.price_in || priceOut !== m.price_out);
    // Carried through whatever its date, and worded on the page without tense
    // ("announced ... from <date>"), so the snapshot stays a pure function of
    // upstream rather than of the day the sync ran. Upstream deletes the block
    // when it applies the change, so a `price_pending` whose date has already
    // passed means ship-sense has not caught up yet — exactly the case worth
    // showing a reader, not hiding.
    const pending = reg.pending;
    const rankSet = ranks.get(m.name);
    const pFirstShare = pFirst[m.name];
    return {
      name: m.name,
      label: m.label,
      provider: m.provider,
      pos: i + 1,
      ...(rankSet ? { rankLo: rankSet.lo, rankHi: rankSet.hi } : {}),
      ...(pFirstShare !== undefined ? { pFirst: Number(pFirstShare.toFixed(4)) } : {}),
      // Rows written before upstream stamped the field inherit their run's.
      testedOn: m.bench_version ?? run.version,
      score: r1(m.score.value),
      lo: r1(m.score.lo),
      hi: r1(m.score.hi),
      restraint: r2(m.restraint.value),
      honesty: r2(m.honesty.value),
      conviction: r2(m.conviction.value),
      priceIn,
      priceOut,
      ...(repriced ? { atTestPriceIn: m.price_in, atTestPriceOut: m.price_out } : {}),
      ...(pending
        ? {
            pendingPriceIn: pending.priceIn,
            pendingPriceOut: pending.priceOut,
            pendingEffective: pending.effective,
          }
        : {}),
    };
  });

  const byName = new Map(models.map((m) => [m.name, m]));
  const generations = previous.map((prev) => {
    const curr = byName.get(succ.get(prev.name)!);
    if (!curr) return fail(`successor ${succ.get(prev.name)} missing from run`);
    const rec = pairwise.find(
      (r) =>
        (r.a === curr.name && r.b === prev.name) ||
        (r.a === prev.name && r.b === curr.name),
    );
    if (!rec) return fail(`no pairwise record for ${prev.name} -> ${curr.name}`);
    const oriented = orientPair(rec, prev.name, curr.name);
    if (!oriented) return fail(`could not orient ${prev.name} -> ${curr.name}`);
    return {
      prevLabel: prev.label,
      currLabel: curr.label,
      prevScore: r1(prev.score.value),
      currScore: r1(curr.score.value),
      deltaPts: r1(oriented.deltaPts),
      loPts: r1(oriented.loPts),
      hiPts: r1(oriented.hiPts),
      verdict: oriented.verdict,
      family: oriented.family,
    };
  });
  generations.sort((a, b) => b.deltaPts - a.deltaPts);

  const floor = floorValue(run);
  if (floor.value === null) fail(`run ${run.run_id} carries neither an adversarial nor a naive floor`);
  const floorRows: FloorRow[] = (run.adversarial_floor ?? []).map((f: FloorRow) => ({
    label: f.label,
    headline: r1(f.headline),
    restraint: r2(f.restraint),
    honesty: r2(f.honesty),
    conviction: r2(f.conviction),
  }));

  const runMeta = {
    version: run.version,
    runId: run.run_id,
    runDate,
    bankItems: run.bank.n_items,
    modelCount: rankedModels.length,
    floor: r1(floor.value!),
    floorKind: floor.kind,
    floorRows,
    decisiveRule: rule,
    decisivePairs: pairwise.filter((r) => matrixWinner(r) !== null).length,
    totalPairs: pairwise.length,
    scoringDates: dates,
  };

  const teaser = lineup.slice(0, 3).map((m) => ({ label: m.label, score: m.score }));

  const emit = (value: unknown) => JSON.stringify(value, null, 2);
  // A --local / file:// source is named generically: the snapshot ships in a
  // public repo and must not carry a path from this machine.
  const source = LOCAL_ROOT ? "a local ship-sense checkout" : RAW;
  const generatedBy = `// GENERATED by scripts/sync-ship-sense.ts — do not edit by hand.
// Source: ${source} (run ${runMeta.runId}, ${runMeta.version}).
// Regenerate with \`npm run sync:shipsense\`; review the diff before committing.`;

  const snapshot = `${generatedBy}
import type {
  ShipSenseGeneration,
  ShipSenseModelRow,
  ShipSenseRunMeta,
} from "./ship-sense";

export const SHIP_SENSE_RUN: ShipSenseRunMeta = ${emit(runMeta)};

export const SHIP_SENSE_LINEUP: ShipSenseModelRow[] = ${emit(lineup)};

export const SHIP_SENSE_GENERATIONS: ShipSenseGeneration[] = ${emit(generations)};
`;

  // The teaser ships in its OWN module: src/pages/Index.tsx is in the entry
  // chunk, and a module shared between the entry and the lazy /benchmark
  // chunk would be hoisted — full lineup included — into the entry bundle.
  // Named imports don't split a shared module; a separate file does.
  const teaserModule = `${generatedBy}
import type { ShipSenseTeaserRow } from "./ship-sense";

export const SHIP_SENSE_TEASER: ShipSenseTeaserRow[] = ${emit(teaser)};

export const SHIP_SENSE_TEASER_RUN = ${emit({
    version: runMeta.version,
    bankItems: runMeta.bankItems,
    modelCount: runMeta.modelCount,
    currentCount: lineup.length,
  })};
`;

  const change = await describeChange(runMeta, lineup);

  const contenders = lineup.filter((m) => m.rankLo === 1).length;
  console.log(
    `[sync-ship-sense] run ${runMeta.runId} ${runMeta.version}: ` +
      `${lineup.length} current (${hasRankSets ? `${contenders} with #1 in rank range` : "no rank sets"}), ` +
      `${generations.length} generations, ${runMeta.decisivePairs}/${runMeta.totalPairs} decisive pairs (${rule}), ` +
      `${floor.kind} floor ${runMeta.floor}, ` +
      `${dates.length} scoring date(s) ${dates[0].date}–${dates[dates.length - 1].date}`,
  );
  console.log(`[sync-ship-sense] ${change.summary}`);

  if (dryRun) {
    console.log("[sync-ship-sense] --dry-run: no files written");
  } else {
    writeFileSync(join(ROOT, "src/data/ship-sense-snapshot.ts"), snapshot);
    writeFileSync(join(ROOT, "src/data/ship-sense-teaser.ts"), teaserModule);
    const card = await fetchBinary("docs/card.png");
    mkdirSync(join(ROOT, "public/benchmark"), { recursive: true });
    writeFileSync(join(ROOT, "public/benchmark/og.png"), card);
    console.log(`[sync-ship-sense] wrote snapshot, teaser, og.png (${card.length} bytes)`);
  }

  if (summaryPath) writeFileSync(summaryPath, `${JSON.stringify(change, null, 2)}\n`);
}

/**
 * Compare the freshly derived board against the committed snapshot so an
 * unattended run can say what actually moved. `runChanged` is the interesting
 * one: a new run_id or version means ship-sense re-scored the bank, and the
 * page's method prose deserves a human read — the workflow escalates instead
 * of pushing.
 */
async function describeChange(
  runMeta: { runId: string; version: string; modelCount: number },
  lineup: {
    label: string;
    score: number;
    priceIn: number;
    priceOut: number;
    pendingPriceIn?: number;
    pendingPriceOut?: number;
    pendingEffective?: string;
  }[],
) {
  const prior = await import("../src/data/ship-sense-snapshot").catch(() => null);
  const priorRun = prior?.SHIP_SENSE_RUN;
  const priorLineup = prior?.SHIP_SENSE_LINEUP ?? [];
  const priorLabels = new Set(priorLineup.map((m) => m.label));
  const labels = new Set(lineup.map((m) => m.label));
  const added = lineup.filter((m) => !priorLabels.has(m.label)).map((m) => m.label);
  const removed = priorLineup.filter((m) => !labels.has(m.label)).map((m) => m.label);
  const rescored = lineup.filter((m) => {
    const was = priorLineup.find((p) => p.label === m.label);
    return was && was.score !== m.score;
  }).length;
  // A price move is the whole change some days — DeepSeek's peak/off-peak
  // switch moved no score and no row. Counting it keeps the unattended commit
  // message from saying "no board movement" over a real diff.
  const repriced = lineup.filter((m) => {
    const was = priorLineup.find((p) => p.label === m.label);
    if (!was) return false;
    return (
      was.priceIn !== m.priceIn ||
      was.priceOut !== m.priceOut ||
      was.pendingPriceIn !== m.pendingPriceIn ||
      was.pendingPriceOut !== m.pendingPriceOut ||
      was.pendingEffective !== m.pendingEffective
    );
  }).length;
  const runChanged = !priorRun || priorRun.runId !== runMeta.runId || priorRun.version !== runMeta.version;

  const parts: string[] = [];
  if (added.length) parts.push(`+${added.join(", +")}`);
  if (removed.length) parts.push(`-${removed.join(", -")}`);
  if (rescored) parts.push(`${rescored} rescored`);
  if (repriced) parts.push(`${repriced} repriced`);
  if (runChanged && priorRun)
    parts.push(`run ${priorRun.runId} ${priorRun.version} -> ${runMeta.runId} ${runMeta.version}`);

  return {
    runId: runMeta.runId,
    version: runMeta.version,
    modelCount: runMeta.modelCount,
    added,
    removed,
    rescored,
    repriced,
    runChanged,
    summary: parts.length ? parts.join("; ") : "no board movement",
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
