/**
 * Pure board-composition logic for the Ship Sense sync, ported from
 * ship-sense/src/leaderboard.py (successions / rank_with_ties /
 * _generation_pairs). Kept separate from sync-ship-sense.ts so the port is
 * unit-testable (src/test/ship-sense.test.ts) without network access.
 */

export interface DeriveScore {
  value: number;
  lo: number;
  hi: number;
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

export interface DerivePairRecord {
  a: string;
  b: string;
  delta: number;
  lo: number;
  hi: number;
  holm_p: number;
  winner: string | null;
}

// One version token per label ("4.6", "5", Moonshot's "K3"), guarded on both
// sides so "Flash-Lite" and "GPT-5.6" never half-match.
const VERSION_TOKEN = /(?<![a-z0-9.])k?(\d+(?:\.\d+)*)(?![a-z0-9.])/i;

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
 * Superseded model name -> its ranked successor's name. A model retires the
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
      newer.sort(
        (x, y) => versionCompare(x.version, y.version) || x.name.localeCompare(y.name),
      );
      out.set(m.name, newer[newer.length - 1].name);
    }
  }
  return out;
}

/**
 * Leader-overlap band over the current lineup, already sorted by score
 * descending: greedy from the top against the band LEADER's lower bound (not
 * the adjacent row — a chain of overlaps must not collapse the field). A
 * "band" of one model is no band at all.
 */
export function leaderBand(sortedDesc: DeriveModel[]): Set<string> {
  const band = new Set<string>();
  let leaderLo: number | null = null;
  for (const m of sortedDesc) {
    if (leaderLo === null) leaderLo = m.score.lo;
    else if (m.score.hi < leaderLo) break;
    band.add(m.name);
  }
  return band.size > 1 ? band : new Set();
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
 * the CI bounds swap AND negate (lo,hi -> -hi,-lo). Decisive = the published
 * Holm-corrected winner; suggestive = the oriented CI clears zero without
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
    deltaPts: delta * 100,
    loPts: lo * 100,
    hiPts: hi * 100,
    verdict,
  };
}
