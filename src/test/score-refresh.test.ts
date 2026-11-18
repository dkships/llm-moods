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
          eq: () => builder,
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

  it("scores a day against the model's usual source mix and keeps the pooled score", async () => {
    const upserts: Record<string, unknown>[] = [];
    const scored = (sentiment: "positive" | "negative", source: string, postedAt: string) => ({
      model_id: model.id,
      sentiment,
      complaint_category: null,
      confidence: 1,
      score: 0,
      content_type: "full_content",
      source,
      posted_at: postedAt,
      created_at: postedAt,
      classification_status: "classified",
    });
    // Ten earlier days: App Store all positive, HN half and half.
    const history = Array.from({ length: 10 }, (_, i) => {
      const day = `2026-05-0${i % 7 + 1}T18:00:00.000Z`;
      return [scored("positive", "appstore", day), scored("positive", "hackernews", day), scored("negative", "hackernews", day)];
    }).flat();
    // Today: HN only, at its usual 50.
    const today = [
      ...Array.from({ length: 10 }, () => scored("positive", "hackernews", "2026-05-08T15:00:00.000Z")),
      ...Array.from({ length: 10 }, () => scored("negative", "hackernews", "2026-05-08T15:00:00.000Z")),
    ];
    const supabase = createRefreshClient({ posts: [...history, ...today], upserts });

    const summary = await refreshScores(supabase, [model], {
      daysBack: 0,
      includeHourly: false,
      now: new Date("2026-05-08T16:00:00.000Z"),
    });

    // Usual mix: HN holds 2/3 of the weight and is capped at half, so App
    // Store (level 100) and HN (level 50) count equally: usual level 75. A
    // day with no App Store posts and HN at its usual level stays at 75.
    expect(upserts[0]).toMatchObject({ score: 75, pooled_score: 50 });
    expect(summary.models.claude).toMatchObject({ fixed_mix: 1 });
  });
});

describe("terminal classification failure demotion", () => {
  const model: ModelRow = { id: "model-1", name: "Claude", slug: "claude" };

  const classified = (hour: number) => ({
    model_id: model.id,
    sentiment: "positive",
    complaint_category: null,
    confidence: 0.95,
    score: 1,
    content_type: "full_content",
    source: "reddit",
    posted_at: `2026-05-08T1${hour}:00:00.000Z`,
    created_at: `2026-05-08T1${hour}:01:00.000Z`,
    classification_status: "classified",
  });

  it("demotes a day with heavy terminal failure to partial_coverage even though coverage reads 1.0", async () => {
    const upserts: Record<string, unknown>[] = [];
    const failed = {
      ...classified(5),
      sentiment: null,
      confidence: null,
      classification_status: "failed",
    };
    const supabase = createRefreshClient({
      posts: [classified(0), classified(1), classified(2), classified(3), classified(4), failed, failed],
      upserts,
    });

    const summary = await refreshScores(supabase, [model], {
      daysBack: 0,
      includeHourly: false,
      now: new Date("2026-05-08T16:00:00.000Z"),
    });

    expect(summary.daily_rows).toBe(1);
    expect(upserts[0]).toMatchObject({
      score_basis_status: "partial_coverage",
      failed_posts: 2,
      classification_coverage: 1,
    });
    expect(upserts[0].score_confidence).not.toBe("high");
  });
});
