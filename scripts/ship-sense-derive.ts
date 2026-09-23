/**
 * Pure board-composition logic for the Ship Sense sync, ported from
 * ship-sense/src/leaderboard.py (successions / _pairwise_bundle /
 * attach_rank_sets / floor_value / _generation_pairs) and src/stats.py
 * (holm_adjust / rank_sets). Kept separate from sync-ship-sense.ts so the port is
 * unit-testable (src/test/ship-sense.test.ts) without network access.
 */

export interface DeriveScore {
  value: number;
  lo: number;
  hi: number;
}

/** An announced list price that has NOT taken effect yet. Ship Sense records
 * these deliberately without applying them (its own `price_pending` block):
 * the price column is what a buyer pays today, and announced changes do get
 * cancelled. Carried through so the page can say a change is coming instead of
 * going silently stale on the effective date. */
export interface RegistryPending {
  /** ISO date the new price takes effect. */
  effective: string;
  priceIn: number;
  priceOut: number;
}

export interface RegistryEntry {
  label?: string;
  priceIn?: number;
  priceOut?: number;
  supersededBy?: string;
  pending?: RegistryPending;
}

/**
 * Minimal scanner for ship-sense models.yaml — two top-level keys, entries at
 * `  - name:`, scalar fields at 4-space indent, and the one nested block the
 * board reads (`price_pending:`, fields at 6-space). Optional quotes and
 * trailing `# comment` on any value. Deliberately no YAML dependency (would
 * dirty both lockfiles for a script that never runs in CI).
 *
 * Nested blocks other than `price_pending` are skipped whole: their 4-space
 * key parses as an empty value and their 6-space children match no field
 * pattern. That is what keeps a sibling block like `price_offpeak` from
 * leaking its `price_in` into the model's own price.
 */
export function parseModelsYaml(text: string): Map<string, RegistryEntry> {
  const registry = new Map<string, RegistryEntry>();
  let current: RegistryEntry | null = null;
  let pending: Partial<RegistryPending> | null = null;
  let inModels = false;

  // A pending block only counts once it carries all three fields — a date with
  // no prices behind it is worse than no notice at all.
  const closePending = () => {
    if (
      current &&
      pending?.effective &&
      pending.priceIn !== undefined &&
      pending.priceOut !== undefined
    )
      current.pending = pending as RegistryPending;
    pending = null;
  };

  for (const line of text.split("\n")) {
    if (/^models:/.test(line)) {
      inModels = true;
      continue;
    }
    if (inModels && /^[A-Za-z_]/.test(line)) {
      closePending();
      inModels = false;
    }
    if (!inModels) continue;

    const entry = line.match(/^ {2}- name:\s*(?:"([^"]*)"|([^\s#]+))/);
    if (entry) {
      closePending();
      current = {};
      registry.set(entry[1] ?? entry[2], current);
      continue;
    }
    if (!current) continue;

    if (pending) {
      // Blank and comment-only lines don't end the block — a comment between
      // two of its fields must not truncate it.
      if (/^\s*(#.*)?$/.test(line)) continue;
      const sub = line.match(/^ {6}([a-z_]+):\s*(?:"([^"]*)"|([^#]*?))\s*(?:#.*)?$/);
      if (sub) {
        const value = (sub[2] ?? sub[3] ?? "").trim();
        if (value !== "") {
          if (sub[1] === "effective") pending.effective = value;
          else if (sub[1] === "price_in") pending.priceIn = Number(value);
          else if (sub[1] === "price_out") pending.priceOut = Number(value);
        }
        continue;
      }
      closePending();
    }
    if (/^ {4}price_pending:\s*(?:#.*)?$/.test(line)) {
      pending = {};
      continue;
    }

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
  closePending();
  return registry;
}

export interface DeriveModel {
  name: string;
  label: string;
  is_baseline: boolean;
  ranked_eligible?: boolean;
  superseded_by?: string | null;
  /** ISO date the model's price was checked. Ship Sense verifies prices at
   * scoring time, so for models merged in after the run date this is the
   * merge date — see scoringDates(). */
  price_verified?: string | null;
  score: DeriveScore;
}

/** One head-to-head record from docs/pairwise.json, 0–1 scale, a − b.
 * Since v4.0 (record_schema 2) each record also carries its raw p-value, the
 * exploratory BH q-value and its test family. `winner` is the verdict of the
 * record's own family (Holm within the confirmatory family, BH q ≤ .05 for
 * exploratory); `winner_exploratory` is the BH verdict for every record. */
export interface DerivePairRecord {
  a: string;
  b: string;
  delta: number;
  lo: number;
  hi: number;
  holm_p: number | null;
  winner: string | null;
  p_value?: number;
  q_value?: number;
  family?: PairFamily;
  winner_exploratory?: string | null;
}

export type PairFamily = "confirmatory" | "exploratory";

// One version token per label ("4.6", "5", Moonshot's "K3", DeepSeek's "V4",
// MiniMax's "M3"), guarded on both sides so "Flash-Lite" and "GPT-5.6" never
// half-match. Mirrors upstream _VERSION_TOKEN's [kmv]? prefix.
const VERSION_TOKEN = /(?<![a-z0-9.])[kmv]?(\d+(?:\.\d+)*)(?![a-z0-9.])/i;

export function lineage(label: string): {
  family: string;
  version: number[] | null;
} {
  const normalize = (s: string) => s.replace(/[\s-]+/g, " ").trim().toLowerCase();
  const m = label.match(VERSION_TOKEN);
  if (!m || m.index === undefined) return { family: normalize(label), version: null };
  const version = m[1].split(".").map(Number);
  const family = label.slice(0, m.index) + label.slice(m.index + m[0].length);
  return { family: normalize(family), version };
}

/** Python-tuple comparison: elementwise, shorter tuple loses on prefix match. */
export function versionCompare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Superseded model name -> its NEAREST ranked successor's name (upstream
 * ruling 2026-08-12: Grok 4.3 pairs with 4.5, not 4.6). A model retires the
 * moment a RANKED model in the same label lineage carries a higher version;
 * explicit declarations (run field or registry `superseded_by`) beat
 * inference and exist only for renamed lines the labels cannot see
 * (GPT-5.5 -> Sol). `ranked_eligible` does NOT distinguish retired models.
 */
export function successions(
  models: DeriveModel[],
  declared: Map<string, string>,
): Map<string, string> {
  const ranked = new Map(
    models
      .filter((m) => !m.is_baseline && (m.ranked_eligible ?? true))
      .map((m) => [m.name, m]),
  );
  const byFamily = new Map<string, { version: number[]; name: string }[]>();
  for (const [name, m] of ranked) {
    const { family, version } = lineage(m.label || name);
    if (version === null) continue;
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family)!.push({ version, name });
  }
  const out = new Map<string, string>();
  for (const m of models) {
    if (m.is_baseline) continue;
    const succ = m.superseded_by || declared.get(m.name);
    if (succ && succ !== m.name && ranked.has(succ)) {
      out.set(m.name, succ);
      continue;
    }
    const { family, version } = lineage(m.label || m.name);
    if (version === null) continue;
    const newer = (byFamily.get(family) ?? []).filter(
      (e) => e.name !== m.name && versionCompare(e.version, version) > 0,
    );
    if (newer.length > 0) {
      // Python min() over (version, name) tuples.
      newer.sort(
        (x, y) => versionCompare(x.version, y.version) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0),
      );
      out.set(m.name, newer[0].name);
    }
  }
  return out;
}

const RANK_SET_ALPHA = 0.05;

/** stats.holm_adjust: Holm step-down adjusted p-values, original order. */
export function holmAdjust(pValues: number[]): number[] {
  const order = pValues.map((_, i) => i).sort((x, y) => pValues[x] - pValues[y]);
  const adjusted = pValues.map(() => 1);
  let running = 0;
  order.forEach((idx, rank) => {
    running = Math.max(running, (pValues.length - rank) * pValues[idx]);
    adjusted[idx] = Math.min(1, running);
  });
  return adjusted;
}

export interface RankSet {
  lo: number;
  hi: number;
}

/**
 * Marginal 95% rank confidence set per model (stats.rank_sets, gated the way
 * leaderboard.attach_rank_sets gates it). For each model, Holm-correct its own
 * N−1 raw p-values against the lineup; its set is [1 + #models that
 * significantly beat it, N − #models it significantly beats]. Needs every
 * lineup pair WITH a raw p-value — legacy records have none, and a board
 * missing a pair gets no ranges rather than wrong ones (empty map).
 */
export function rankSets(names: string[], records: DerivePairRecord[]): Map<string, RankSet> {
  const lineup = new Set(names);
  const inLineup = records.filter((r) => lineup.has(r.a) && lineup.has(r.b));
  const pairsNeeded = (names.length * (names.length - 1)) / 2;
  const usable =
    names.length > 0 &&
    inLineup.length === pairsNeeded &&
    inLineup.every((r) => typeof r.p_value === "number");
  if (!usable) return new Map();

  const mine = new Map<string, { p: number; diff: number }[]>(names.map((n) => [n, []]));
  for (const r of inLineup) {
    mine.get(r.a)!.push({ p: r.p_value!, diff: r.delta });
    mine.get(r.b)!.push({ p: r.p_value!, diff: -r.delta });
  }

  const out = new Map<string, RankSet>();
  for (const name of names) {
    const rows = mine.get(name)!;
    const adjusted = holmAdjust(rows.map((r) => r.p));
    let beatenBy = 0;
    let beats = 0;
    rows.forEach((r, i) => {
      if (adjusted[i] > RANK_SET_ALPHA) {
        return;
      }
      if (r.diff < 0) {
        beatenBy++;
      } else if (r.diff > 0) {
        beats++;
      }
    });
    out.set(name, { lo: 1 + beatenBy, hi: names.length - beats });
  }
  return out;
}

export interface PairwiseBundle {
  records: DerivePairRecord[];
  /** Descriptive bootstrap P(#1) per current-lineup model; {} on legacy files. */
  pFirst: Record<string, number>;
}

/** leaderboard._pairwise_bundle for docs/pairwise.json: a bare list (≤ v3.6)
 * or {record_schema, records, p_first} (v4.0+). */
export function parsePairwise(data: unknown): PairwiseBundle {
  if (Array.isArray(data)) {
    return { records: data as DerivePairRecord[], pFirst: {} };
  }
  if (data && typeof data === "object" && Array.isArray((data as { records?: unknown }).records)) {
    const d = data as { records: DerivePairRecord[]; p_first?: Record<string, number> | null };
    return { records: d.records, pFirst: d.p_first ?? {} };
  }
  throw new Error("[ship-sense-derive] pairwise.json is neither a list nor a {records} bundle");
}

/** How the head-to-head matrix calls a pair decisive: the exploratory BH
 * q-value when records carry one, else the legacy all-pairs Holm test. */
export type DecisiveRule = "bh" | "holm";

export const decisiveRule = (records: DerivePairRecord[]): DecisiveRule =>
  records.some((r) => r.q_value !== undefined) ? "bh" : "holm";

/** The matrix's decisive winner (leaderboard._cell_state): winner_exploratory
 * on q-value records — a present-but-null value means "not decisive", exactly
 * like Python's dict.get(key, default) — else the legacy winner. */
export const matrixWinner = (r: DerivePairRecord): string | null => {
  if (r.q_value === undefined || r.winner_exploratory === undefined) {
    return r.winner;
  }
  return r.winner_exploratory;
};

export interface FloorRow {
  label: string;
  /** 0–100 on the Ship Sense Score scale. */
  headline: number;
  restraint: number;
  honesty: number;
  conviction: number;
}

export type FloorKind = "adversarial" | "naive";

/** leaderboard.floor_value: the best adversarial headline when the run carries
 * one (v4.0+), else the legacy naive floor. */
export function floorValue(run: {
  naive_floor?: number | null;
  adversarial_floor?: FloorRow[] | null;
}): { value: number | null; kind: FloorKind } {
  const rows = run.adversarial_floor ?? [];
  if (rows.length > 0) {
    return { value: Math.max(...rows.map((r) => r.headline)), kind: "adversarial" };
  }
  return { value: run.naive_floor ?? null, kind: "naive" };
}

export interface ScoringDateGroup {
  /** ISO date this group of models was scored on. */
  date: string;
  /** Model labels scored on this date, in board order (score descending). */
  labels: string[];
}

/**
 * Reconstruct the run's scoring dates. A Ship Sense run keeps one run_id but
 * absorbs models scored later on the identical bank (v3.0: 17 on 2026-07-10,
 * then four merges through 08-03), and leaderboard.json records no per-model
 * scoring date. `price_verified` stands in: Ship Sense verifies a model's
 * price when it scores it, so a merged-in model carries a price_verified
 * AFTER the run date while every base-run model carries one at or before it.
 * Clamping to run_id collapses the base run into a single group.
 *
 * Verified against the ship-sense README "How the current snapshot was built"
 * for v3.0: 07-10 / 07-17 / 07-21 / 07-24 / 08-03, exact match. If the two
 * ever diverge, the README is the source of truth and this heuristic is the
 * thing to fix.
 *
 * `models` must already be in board order; the caller decides which models
 * count (ranked only — baselines never appear on the page).
 */
export function scoringDates(
  models: Pick<DeriveModel, "label" | "price_verified">[],
  runId: string,
): ScoringDateGroup[] {
  const groups = new Map<string, string[]>();
  for (const m of models) {
    const verified = m.price_verified ?? "";
    const date = verified > runId ? verified : runId;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(m.label);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, labels]) => ({ date, labels }));
}

export interface OrientedPair {
  /** Test family that decided the verdict; legacy records are one Holm family. */
  family: PairFamily | "legacy";
  deltaPts: number;
  loPts: number;
  hiPts: number;
  verdict:
    | "decisive-up"
    | "suggestive-up"
    | "up"
    | "even"
    | "down"
    | "suggestive-down"
    | "decisive-down";
}

/**
 * Orient a pairwise record as (current − previous) in board points (×100).
 * Records are stored in arbitrary a/b order on a 0–1 scale; when flipping,
 * the CI bounds swap AND negate (lo,hi -> -hi,-lo). Decisive = the record's
 * published `winner` (upstream _generation_pairs reads that field, so a
 * confirmatory succession is decided by Holm within its family); suggestive = the oriented CI clears zero without
 * surviving correction.
 */
export function orientPair(
  rec: DerivePairRecord,
  prevName: string,
  currName: string,
): OrientedPair | null {
  let sign: 1 | -1;
  if (rec.a === currName && rec.b === prevName) sign = 1;
  else if (rec.a === prevName && rec.b === currName) sign = -1;
  else return null;
  const delta = sign * rec.delta;
  const [lo, hi] = sign > 0 ? [rec.lo, rec.hi] : [-rec.hi, -rec.lo];
  let verdict: OrientedPair["verdict"];
  if (rec.winner === currName) verdict = "decisive-up";
  else if (rec.winner === prevName) verdict = "decisive-down";
  else if (lo > 0) verdict = "suggestive-up";
  else if (hi < 0) verdict = "suggestive-down";
  else if (delta > 0) verdict = "up";
  else if (delta < 0) verdict = "down";
  else verdict = "even";
  return {
    family: rec.family ?? "legacy",
    deltaPts: delta * 100,
    loPts: lo * 100,
    hiPts: hi * 100,
    verdict,
  };
}

export interface LedgerRun {
  run_id: string;
  version?: string | null;
  models: DeriveModel[];
}

/**
 * leaderboard._previous_snapshot: the newest run (before the latest) whose
 * version differs from the latest run's version, or null when every earlier
 * run shares it (or there is no earlier run). Used to find the most recent
 * prior bench version whose successions should still be shown alongside the
 * latest run's.
 */
export function previousBenchSnapshot(runs: LedgerRun[]): LedgerRun | null {
  if (runs.length === 0) return null;
  const latestVersion = runs[runs.length - 1].version;
  for (let i = runs.length - 2; i >= 0; i--) {
    const run = runs[i];
    if (run.version && run.version !== latestVersion) return run;
  }
  return null;
}

export interface GenerationPair {
  prevLabel: string;
  currLabel: string;
  prevScore: number;
  currScore: number;
  deltaPts: number;
  loPts: number;
  hiPts: number;
  verdict: OrientedPair["verdict"];
  family: OrientedPair["family"];
}

/**
 * leaderboard._generation_pairs, given an already-computed successions map:
 * one entry per succession that has a published head-to-head record, sorted
 * by paired delta descending. A pair with no record in `records` is dropped
 * rather than failing — needed for an older bench snapshot, whose successions
 * must not block the sync just because one predecessor's pairwise row is
 * missing from its archived file.
 */
export function generationPairsFromSuccessions(
  models: DeriveModel[],
  succ: Map<string, string>,
  records: DerivePairRecord[],
  round: (n: number) => number = (n) => n,
): GenerationPair[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const pairs: GenerationPair[] = [];
  for (const [prevName, currName] of succ) {
    const prev = byName.get(prevName);
    const curr = byName.get(currName);
    if (!prev || !curr) continue;
    const rec = records.find(
      (r) => (r.a === currName && r.b === prevName) || (r.a === prevName && r.b === currName),
    );
    if (!rec) continue;
    const oriented = orientPair(rec, prevName, currName);
    if (!oriented) continue;
    pairs.push({
      prevLabel: prev.label,
      currLabel: curr.label,
      prevScore: round(prev.score.value),
      currScore: round(curr.score.value),
      deltaPts: round(oriented.deltaPts),
      loPts: round(oriented.loPts),
      hiPts: round(oriented.hiPts),
      verdict: oriented.verdict,
      family: oriented.family,
    });
  }
  pairs.sort((a, b) => b.deltaPts - a.deltaPts);
  return pairs;
}
