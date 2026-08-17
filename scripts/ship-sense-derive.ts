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
