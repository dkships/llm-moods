# LLM Moods — Operations & Audit History

Historical audit records and one-time investigations. Not operating instructions —
the live rules live in `CLAUDE.md`. Read this when you need the provenance of a number
or a past decision.

## 2026-07-01 — quality audit (Fable 5) + fixes

Three-lens audit (frontend/UX, backend/pipeline, public-facing/SEO) with adversarial
verification. Shipped in one batch:

- **Deleted `apify-actor-probe`** from the repo, along with the `.lovable/plan.md`
  standing instruction to deploy it. June bake-off helper, ungated with
  caller-controlled `maxTotalChargeUsd`/`maxItems` (no upper clamp) — an anonymous
  Apify-credit spender if deployed. Verified NOT live at audit time (functions
  gateway returns NOT_FOUND vs 400 for deployed functions), so the fix removes the
  deployable recipe rather than a live hole.
- **Fixed the watchdog scraper-staleness arm**: it had matched short source names
  against `scrape-*` slug run rows since its first commit (2026-05-10), inserting 5
  spurious critical rows hourly (~120/day) while real staleness was invisible. Now
  per-source slug thresholds (14h reddit / 11h others) + a 30h no-success arm over a
  72h runs window. Expected observable: the hourly "Scraper 'X' has not run in >12h"
  error_log noise stops after redeploy.
- **Privacy page** now carries the retention policy (~90 days for posts, with the
  three documented carve-outs: aggregate scores, rumor source refs, article quotes)
  and a removal channel (GitHub issues / LinkedIn) — the prerendered meta had promised
  both since May without the page delivering either.
- Rumors/TrendingComplaints error states (outages no longer masquerade as empty
  states), `Promise.all` on the landing RPC pair, chart `role="img"` labels +
  section-level ErrorBoundaries, sitemap lastmod, ItemList JSON-LD on /research,
  404 noindex + canonical suppression (useHead extension), RSS author email removed,
  dead code removed (`classification-queue.ts`, `triggerAggregateVibes`, `fadeUp`,
  `getKnownSurfacesForModel`, duplicate `getPacificDateLabel`, duplicate safe-URL
  helpers), drain fallback defaults aligned to prod (200/20), origin-side 5-min cache
  on `fetch-vendor-status`, eslint edge-function override + GitHub Actions CI.
- Deferred consciously: scheduler-gate spoofability (documented as accepted risk in
  `AGENT-REFERENCE.md`), chatter cursor tie-skip (needs a migration), reclassify-posts
  broken `find_multi_model_misclassified` branch (fix at next redeploy of that fn).

## 2026-05-16 — methodology + scoring + scraper + historical-numbers audit

Full end-to-end audit. Read-only snapshot pulled 16,496 posts (Feb 15 – May 16) and all
335 daily score rows from public REST. Findings + actions:

- **All four research article numbers verified exact (+0.0)**: Feb 15–18 baseline (claude 71.0 / chatgpt 80.8 / gemini 76.0 / grok 48.5) and Mar 26 – Apr 10 cache-bug window (claude 47.6 / chatgpt 32.0 / gemini 38.4 / grok 34.6). Per-model eligible-post totals (claude 932, chatgpt 1006, gemini 440, grok 259) also reproduce.
- **Reaggregate-vibes 30-day dry-run produced zero score changes** across 124 rows (31/model × 4). Pipeline is fully idempotent against current state. No apply needed.
- **Classifier-drift check (90 days, per-model per-week ratios)**: a 22–37pp neutral-share collapse the week of Mar 16–22 is fully explained by the documented Mar 20–22 pipeline overhaul (Lovable AI gateway → Gemini Flash-Lite → 3.1 Flash-Lite, then Apr 25 → 2.5 Flash). Not active drift; one-time transition. Disclosure added to `how-llm-vibes-classifies-sentiment`.
- **2026-05-07 backfill** via temporary `audit-may16` helper edge fn (deleted post-run): twitter 7→114, HN 1→18, totals 145→269. HN Algolia date-range run inserted 0 (all dedup/filter), Apify date-range run inserted 20 to twitter; remaining post growth came from later scraper cycles.
- **Vendor status-page correlation (90-day window, ±48h match)**: 20 anomalies detected, 5 explained by Anthropic / OpenAI / xAI status events, 15 unexplained (mostly because vendor feeds only retain ~30 days, so March drops lack a live entry). xAI feed IS available at `status.x.ai/feed.xml` — earlier CLAUDE.md note ("no public status feed") was outdated.
- **scraper_runs + error_log return [] HTTP 200 to anon**: RLS denial assumed (admin panel queries via service-role). Not investigated this session — follow-up.

## Design-system primitives — PR provenance

Provenance for the shared design primitives (the live rules are in `CLAUDE.md`). Built
across Apr 2026 polish PRs #5/#7, May 2026 Round 2 PRs #18–#25, Round 3 PRs #27–#36:

- `Surface.tsx`: `tight` size removed R3-06; `tone="accent"` left-border variant removed R2-07.
- `FilterChip.tsx`: `variant` rect/pill prop removed R2-03.
- `Tag.tsx`: added R3-03; replaced every shadcn `<Badge>` and hand-rolled pill (severity, correlation, research tags, "Updated", translation).
- `ModelCard.tsx` deduped R3-04 (`showSparkline`); `ChatterPost.tsx` deduped R3-05 (`extraMeta`, `hideModel`).
- `SectionHeader.tsx`: `icon` prop removed R2-02; sentence-case titles R3-08.
- `BarList.tsx`: added R2-06.
- `ScoreMetaBadge` + `DataFreshnessIndicator` deleted in Round 2 — don't reintroduce.
- Type ladder: `text-hero` rung added R3-01. Severity/staleness tint rules R3-02 / R3-07.
