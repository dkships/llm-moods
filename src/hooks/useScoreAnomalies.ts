import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AnomalySeverity = "breach" | "watch" | "normal";

export interface ScoreAnomaly {
  modelId: string;
  modelSlug: string;
  modelName: string;
  accentColor: string | null;
  periodStart: string;
  score: number;
  baselineMean: number;
  baselineStddev: number;
  z: number;
  severity: AnomalySeverity;
  sampleSize: number;
  totalPosts: number;
  topComplaint: string | null;
}

export interface UseScoreAnomaliesOptions {
  /** Number of recent days to compute z-scores for. Defaults to 30. */
  recentDays?: number;
  /** Trailing window length (days) for the baseline. Defaults to 14. */
  lookbackDays?: number;
  /** Minimum sample size required in the baseline window. Defaults to 7. */
  minBaselineDays?: number;
  /** Minimum |z| to surface as `watch`. Defaults to 2. */
  watchThreshold?: number;
  /** Minimum |z| to surface as `breach`. Defaults to 3. */
  breachThreshold?: number;
}

interface ScoreRow {
  model_id: string;
  score: number;
  period_start: string;
  total_posts: number | null;
  eligible_posts?: number | null;
  score_basis_status?: string | null;
  classification_coverage?: number | null;
  top_complaint: string | null;
}

interface ModelRow {
  id: string;
  slug: string;
  name: string;
  accent_color: string | null;
}

function classify(z: number, watch: number, breach: number): AnomalySeverity {
  const abs = Math.abs(z);
  if (abs >= breach) return "breach";
  if (abs >= watch) return "watch";
  return "normal";
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sampleStddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function useScoreAnomalies(options: UseScoreAnomaliesOptions = {}) {
  const recentDays = options.recentDays ?? 30;
  const lookbackDays = options.lookbackDays ?? 14;
  // 3 (was 7): lets new models or models that just emerged from a carry-forward
  // gap surface anomalies sooner. Combined with the carry-forward exclusion
  // below, the baseline now reflects real data only.
  const minBaselineDays = options.minBaselineDays ?? 3;
  const watchThreshold = options.watchThreshold ?? 2;
  const breachThreshold = options.breachThreshold ?? 3;

  return useQuery<ScoreAnomaly[]>({
    queryKey: [
      "score-anomalies",
      recentDays,
      lookbackDays,
      minBaselineDays,
      watchThreshold,
      breachThreshold,
    ],
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const totalDays = recentDays + lookbackDays + 1;
      const since = new Date(Date.now() - totalDays * 24 * 60 * 60 * 1000).toISOString();

      const [scoresResult, modelsResult] = await Promise.all([
        supabase
          .from("vibes_scores")
          .select("model_id, score, period_start, total_posts, eligible_posts, score_basis_status, classification_coverage, top_complaint")
          .eq("period", "daily")
          .gte("period_start", since)
          .order("period_start", { ascending: true })
          .limit(200),
        supabase.from("models").select("id, slug, name, accent_color"),
      ]);

      if (scoresResult.error) throw scoresResult.error;
      if (modelsResult.error) throw modelsResult.error;

      const rows = (scoresResult.data ?? []) as ScoreRow[];
      const modelMap = new Map<string, ModelRow>();
      for (const m of (modelsResult.data ?? []) as ModelRow[]) {
        modelMap.set(m.id, m);
      }

      const byModel = new Map<string, ScoreRow[]>();
      for (const row of rows) {
        const list = byModel.get(row.model_id) ?? [];
        list.push(row);
        byModel.set(row.model_id, list);
      }

      const recentCutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).getTime();
      const anomalies: ScoreAnomaly[] = [];

      for (const [modelId, modelRows] of byModel.entries()) {
        const model = modelMap.get(modelId);
        if (!model) continue;

        const sorted = [...modelRows].sort(
          (a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime(),
        );

        for (let i = 0; i < sorted.length; i++) {
          const row = sorted[i];
          const rowTime = new Date(row.period_start).getTime();
          if (rowTime < recentCutoff) continue;

          const windowStart = rowTime - lookbackDays * 24 * 60 * 60 * 1000;
          const baseline: number[] = [];
          for (let j = 0; j < i; j++) {
            const t = new Date(sorted[j].period_start).getTime();
            if (t < windowStart || t >= rowTime) continue;
            // Exclude carry-forward rows — they inherit yesterday's score with
            // total_posts=0, so including them biases the baseline mean toward
            // stale numbers and inflates |z| on the next real-data day.
            if ((sorted[j].total_posts ?? 0) === 0) continue;
            if (sorted[j].score_basis_status && sorted[j].score_basis_status !== "measured") continue;
            if ((sorted[j].eligible_posts ?? 0) < 5) continue;
            baseline.push(sorted[j].score);
          }

          if (baseline.length < minBaselineDays) continue;
          if (row.score_basis_status && row.score_basis_status !== "measured") continue;
          if ((row.eligible_posts ?? 0) < 5) continue;
          if ((row.classification_coverage ?? 1) < 0.8) continue;

          const avg = mean(baseline);
          // Floor stddev at 1.0 — a too-stable baseline (stddev<1) blows up
          // |z| on a 3-point swing. Quiet models would otherwise flash
          // "breach" on noise.
          const stddev = Math.max(sampleStddev(baseline, avg), 1);

          const z = (row.score - avg) / stddev;
          const severity = classify(z, watchThreshold, breachThreshold);

          anomalies.push({
            modelId,
            modelSlug: model.slug,
            modelName: model.name,
            accentColor: model.accent_color,
            periodStart: row.period_start,
            score: row.score,
            baselineMean: avg,
            baselineStddev: stddev,
            z,
            severity,
            sampleSize: baseline.length,
            totalPosts: row.total_posts ?? 0,
            topComplaint: row.top_complaint,
          });
        }
      }

      anomalies.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
      return anomalies;
    },
  });
}
