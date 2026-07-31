/**
 * Sync the Ship Sense benchmark snapshot from github.com/dkships/ship-sense.
 *
 * Manual, not part of the build: run `npm run sync:shipsense` after each
 * official Ship Sense run, review the diff, update EXPECTED below and the
 * SHIP_SENSE_SCORED_WINDOW entry in src/data/ship-sense.ts, then commit.
 *
 * Fetches leaderboard.json (scores), models.yaml (current prices + explicit
 * successions), docs/pairwise.json (paired head-to-head records), and
 * docs/card.png (OG image), then ports the board-composition logic from
 * ship-sense/src/leaderboard.py:
 *   - successions(): label-lineage inference (a ranked line-mate with a higher
 *     version retires a model) with explicit `superseded_by` overriding —
 *     `ranked_eligible`/`coverage_status` do NOT distinguish retired models.
 *   - rank_with_ties(): leader-overlap band computed greedily against the
 *     band LEADER's lower bound, over the current lineup only, after
 *     re-ranking.
 *   - _generation_pairs(): pairwise records are stored in arbitrary
 *     orientation on a 0–1 scale — normalize to (current − previous) × 100
 *     and swap-negate the CI bounds when flipping.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  leaderBand,
  orientPair,
  successions,
  type DerivePairRecord,
} from "./ship-sense-derive";

const RAW = "https://raw.githubusercontent.com/dkships/ship-sense/main";
const ROOT = join(import.meta.dirname ?? __dirname, "..");

// Fail-loud expectations for the CURRENT official run. A mismatch means either
// a new official run (update these from the ship-sense README leaderboard) or
// a bug in the derivation port (fix it) — never ship the diff without knowing
// which.
const EXPECTED = { lineup: 13, generations: 8, pairs: 210 };

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
  is_baseline: boolean;
  ranked_eligible?: boolean;
  superseded_by?: string | null;
  score: Score;
  restraint: Score;
  honesty: Score;
  conviction: Score;
}

interface PairRecord {
  a: string;
  b: string;
  delta: number;
  lo: number;
  hi: number;
  holm_p: number;
  winner: string | null;
}

interface RegistryEntry {
  label?: string;
  priceIn?: number;
  priceOut?: number;
  supersededBy?: string;
}

const fail = (msg: string): never => {
  throw new Error(`[sync-ship-sense] ${msg}`);
};

async function fetchText(path: string): Promise<string> {
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) fail(`GET ${path} -> ${res.status}`);
  return res.text();
}

async function fetchBinary(path: string): Promise<Buffer> {
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) fail(`GET ${path} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Minimal scanner for ship-sense models.yaml — two top-level keys, entries at
 * `  - name:`, scalar fields at 4-space indent, optional quotes and trailing
 * `# comment`. Deliberately no YAML dependency (would dirty both lockfiles for
 * a script that never runs in CI). */
function parseModelsYaml(text: string): Map<string, RegistryEntry> {
  const registry = new Map<string, RegistryEntry>();
  let current: RegistryEntry | null = null;
  let inModels = false;
  for (const line of text.split("\n")) {
    if (/^models:/.test(line)) {
      inModels = true;
      continue;
    }
    if (inModels && /^[A-Za-z_]/.test(line)) inModels = false;
    if (!inModels) continue;
    const entry = line.match(/^ {2}- name:\s*(?:"([^"]*)"|([^\s#]+))/);
    if (entry) {
      current = {};
      registry.set(entry[1] ?? entry[2], current);
      continue;
    }
    if (!current) continue;
    const field = line.match(/^ {4}([a-z_]+):\s*(?:"([^"]*)"|([^#]*?))\s*(?:#.*)?$/);
    if (!field) continue;
    const key = field[1];
    const value = (field[2] ?? field[3] ?? "").trim();
    if (value === "") continue;
    if (key === "label") current.label = value;
    else if (key === "price_in") current.priceIn = Number(value);
    else if (key === "price_out") current.priceOut = Number(value);
    else if (key === "superseded_by") current.supersededBy = value;
  }
  if (registry.size === 0) fail("models.yaml scanner matched no entries");
  return registry;
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
  const pairwise: PairRecord[] = JSON.parse(pairwiseText);

  const rankedModels = models.filter(
    (m) => !m.is_baseline && (m.ranked_eligible ?? true),
  );

  // Pairwise integrity: no run_id in the file, so verify it matches this run
  // by shape — C(ranked, 2) rows, every id present in the run.
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
  const band = leaderBand(current);

  if (current.length !== EXPECTED.lineup)
    fail(`derived ${current.length} current models, expected ${EXPECTED.lineup} — new run or lineage-port bug (see EXPECTED)`);
  if (previous.length !== EXPECTED.generations)
    fail(`derived ${previous.length} succession pairs, expected ${EXPECTED.generations}`);
  if (pairwise.length !== EXPECTED.pairs)
    fail(`pairwise has ${pairwise.length} rows, expected ${EXPECTED.pairs}`);

  const lineup = current.map((m, i) => {
    const reg = registry.get(m.name) ?? {};
    const priceIn = reg.priceIn ?? m.price_in ?? 0;
    const priceOut = reg.priceOut ?? m.price_out ?? 0;
    const repriced =
      m.price_in !== null &&
      m.price_out !== null &&
      (priceIn !== m.price_in || priceOut !== m.price_out);
    return {
      name: m.name,
      label: m.label,
      provider: m.provider,
      pos: i + 1,
      inLeaderBand: band.has(m.name),
      score: r1(m.score.value),
      lo: r1(m.score.lo),
      hi: r1(m.score.hi),
      restraint: r2(m.restraint.value),
      honesty: r2(m.honesty.value),
      conviction: r2(m.conviction.value),
      priceIn,
      priceOut,
      ...(repriced ? { atTestPriceIn: m.price_in, atTestPriceOut: m.price_out } : {}),
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
    const oriented = orientPair(rec as DerivePairRecord, prev.name, curr.name);
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
    };
  });
  generations.sort((a, b) => b.deltaPts - a.deltaPts);

  const runMeta = {
    version: run.version,
    runId: run.run_id,
    bankItems: run.bank.n_items,
    modelCount: rankedModels.length,
    naiveFloor: run.naive_floor,
    decisivePairs: pairwise.filter((r) => r.winner !== null).length,
    totalPairs: pairwise.length,
  };

  const teaser = lineup.slice(0, 3).map((m) => ({ label: m.label, score: m.score }));

  const emit = (value: unknown) => JSON.stringify(value, null, 2);
  const generatedBy = `// GENERATED by scripts/sync-ship-sense.ts — do not edit by hand.
// Source: ${RAW} (run ${runMeta.runId}, ${runMeta.version}).
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
  })};
`;

  writeFileSync(join(ROOT, "src/data/ship-sense-snapshot.ts"), snapshot);
  writeFileSync(join(ROOT, "src/data/ship-sense-teaser.ts"), teaserModule);

  const card = await fetchBinary("docs/card.png");
  mkdirSync(join(ROOT, "public/benchmark"), { recursive: true });
  writeFileSync(join(ROOT, "public/benchmark/og.png"), card);

  console.log(
    `[sync-ship-sense] run ${runMeta.runId} ${runMeta.version}: ` +
      `${lineup.length} current (band of ${lineup.filter((m) => m.inLeaderBand).length}), ` +
      `${generations.length} generations, ${runMeta.decisivePairs}/${runMeta.totalPairs} decisive pairs, ` +
      `og.png ${card.length} bytes`,
  );
  console.log(
    "[sync-ship-sense] reminder: if run_id changed, update SHIP_SENSE_SCORED_WINDOW in src/data/ship-sense.ts and EXPECTED in this script.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
