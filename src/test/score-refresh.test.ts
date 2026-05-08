import { describe, expect, it } from "vitest";

import { refreshScores, type ModelRow } from "../../supabase/functions/_shared/score-refresh";

type TableName = "scraped_posts" | "vibes_scores";

function createRefreshClient(options: {
  posts: Record<string, unknown>[];
  seedRows?: Record<string, unknown>[];
  upserts: Record<string, unknown>[];
}) {
  return {
    from(table: TableName) {
      if (table === "scraped_posts") {
        const builder = {
          select: () => builder,
          gte: () => builder,
          lt: () => builder,
          order: () => builder,
          range: async () => ({ data: options.posts, error: null }),
        };
        return builder;
      }

      const builder = {
        select: () => builder,
        eq: () => builder,
        lt: () => builder,
        order: () => builder,
        limit: async () => ({ data: options.seedRows ?? [], error: null }),
        upsert: async (rows: Record<string, unknown>[]) => {
          options.upserts.push(...rows);
          return { error: null };
        },
      };
      return builder;
    },
  };
}

describe("score refresh pipeline", () => {
  const model: ModelRow = {
    id: "model-1",
    name: "Claude",
    slug: "claude",
  };

  it("does not write current-day carry-forward scores when no measured input exists", async () => {
    const upserts: Record<string, unknown>[] = [];
    const supabase = createRefreshClient({
      posts: [],
      seedRows: [{ period_start: "2026-05-06T07:00:00.000Z", score: 64 }],
      upserts,
    });

    const summary = await refreshScores(supabase, [model], {
      daysBack: 0,
      includeHourly: false,
      now: new Date("2026-05-08T16:00:00.000Z"),
    });

    expect(summary.daily_rows).toBe(0);
    expect(summary.skipped_days).toBe(1);
    expect(upserts).toEqual([]);
  });

  it("counts pending classifications against coverage but not sentiment totals", async () => {
    const upserts: Record<string, unknown>[] = [];
    const supabase = createRefreshClient({
      posts: [
        {
          model_id: model.id,
          sentiment: "positive",
          complaint_category: null,
          confidence: 0.95,
          score: 1,
          content_type: "full_content",
          source: "reddit",
          posted_at: "2026-05-08T15:00:00.000Z",
          created_at: "2026-05-08T15:01:00.000Z",
          classification_status: "classified",
        },
        {
          model_id: model.id,
          sentiment: null,
          complaint_category: null,
          confidence: null,
          score: 1,
          content_type: "full_content",
          source: "reddit",
          posted_at: "2026-05-08T15:05:00.000Z",
          created_at: "2026-05-08T15:06:00.000Z",
          classification_status: "pending",
        },
      ],
      upserts,
    });

    const summary = await refreshScores(supabase, [model], {
      daysBack: 0,
      includeHourly: false,
      now: new Date("2026-05-08T16:00:00.000Z"),
    });

    expect(summary.daily_rows).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      total_posts: 2,
      eligible_posts: 1,
      positive_count: 1,
      negative_count: 0,
      neutral_count: 0,
      queued_posts: 1,
      unclassified_posts: 1,
      score_basis_status: "partial_coverage",
    });
    expect(upserts[0].classification_coverage).toBe(0.5);
  });
});
