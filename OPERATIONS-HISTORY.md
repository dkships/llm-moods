# LLM Moods — Operations & Audit History

Historical audit records and one-time investigations. Not operating instructions —
the live rules live in `CLAUDE.md`. Read this when you need the provenance of a number
or a past decision.

## 2026-07-30 — Anthropic spend audit + compact-irrelevant output trim

Trigger: "are we overspending on Anthropic?" Estimated total Anthropic spend
**~$20–30/mo** (chars÷4 modeling; no token telemetry stored for the drain):
~90% is the Haiku 4.5 classifier drain at the **current ~1,090 posts/day**
ingest (12-day mean from `get_scraper_monitor_runs`, 2026-07-18→29 — roughly
2× the ~500–650/day the June 1 note in `AGENT-REFERENCE.md` was modeled on,
after the 2026-07-10 App Store + HN-comment source additions). Output tokens
(≈$5/MTok) are the larger half of the bill; input ≈ $8/mo.

- **Shipped, then validated NO-GO and reverted same day**: compact-irrelevant
  output trim (bare `{"relevant": false}` for irrelevant posts; Anthropic tool
  schema `required` relaxed to `["relevant"]`; est. ~$3–4/mo). Live drain after
  deploy (66 fresh HN posts): **30 classified / 0 irrelevant / 36 parse_error**
  — the classifier OMITTED irrelevant posts from the results array entirely
  instead of emitting compact entries. Short arrays keep their "trustworthy
  prefix" (the May truncation decision), so interleaved omissions shifted
  sentiment onto the wrong posts as terminal `classified`.
  **Attribution correction (post-incident):** the Anthropic account had
  already hit its monthly usage cap (~00:40 UTC, the hourly rumors run), so
  Haiku never actually served these drains — every batch 400'd and the
  **Gemini spillover ran the compact prompts instead**. Gemini's strict
  `response_format` constrains item *shape* but not array *length*, so the
  omissions came from Gemini; Haiku's behavior under the relaxed schema was
  never observed. The NO-GO stands regardless — the change corrupted
  alignment through a live path — but the mechanism is provider-agnostic
  prompt/shape ambiguity, not a Haiku quirk. **Do not re-attempt via prompt
  wording** — a safe retry needs index-keyed results (`{"i": N, ...}`) or a
  hard length-match guard (which conflicts with truncation-prefix recovery).
  Cleanup (run after redeploying the revert) — every bad-code write carries
  the version tag:
  `UPDATE public.scraped_posts SET classification_status='pending',
  classification_attempts=0, next_classification_at=null,
  last_classification_error=null, classified_at=null, sentiment=null,
  complaint_category=null, praise_category=null, confidence=null
  WHERE classifier_version LIKE '%-2026-07-30';`
  (Also resets the Gemini-spillover-recovered rows with the same tag — those
  were correct, but re-classifying them costs pennies and keeps the predicate
  simple.) `CLASSIFIER_VERSION_DATE` restored to 2026-06-01, so post-revert
  writes are distinguishable from bad-code writes.
- **Re-confirmed the 2026-07-17 Batch API rejection** after a fresh adversarial
  review: beyond the known two-phase rework + watchdog conflict, an in-flight
  status would read as coverage 1.0 in `score-refresh.ts` (falsely `measured`/
  high-confidence scores, suppressed partial-coverage warnings, anomaly false
  positives), needs a `classification_status` CHECK migration + RPC widening,
  and has lock/orphan-batch double-billing races. At ~$8–12/mo upside the
  verdict stands; revisit only if classifier volume grows ~5×.
- **Doc fix**: `docs/architecture-reference.md` cron table still showed
  `aggregate-rumors-2x`; live schedule has been hourly (`40 * * * *`) since
  `20260711210000_rumor_discovery_fast_lane.sql`. Rumors extractor ≈ $1–3/mo.
- **Monthly usage cap hit 2026-07-30 ~00:40 UTC** ("You have reached your
  specified API usage limits… regain access 2026-08-01 00:00 UTC" — HTTP 400
  `invalid_request_error`, NOT transient-classed, so rows dead-letter after 5
  attempts instead of deferring). July's classifier spend consumed the
  Console-configured cap by day 30 — independent confirmation the drain runs
  ~$20+/mo at current volume. **Diagnostic lesson: a cap-hit 400 masquerades
  as a classifier bug** — the drain keeps "working" via Gemini spillover
  (~200 posts/day bucket) while everything else churns to `failed`. Check
  `last_classification_error` for the usage-limit string before diagnosing
  code. Recovery: after cap reset (or a Console limit raise), `retry` rows
  self-heal; dead-lettered rows need `reclassify-posts?mode=reset_failed`
  with an `error_pattern` matching "usage limits" (NOT `transient` — the
  pattern list won't match a 400), then `reaggregate-vibes`.

## 2026-08-22 — Cost & simplicity audit (Fable 5 + 4 Sonnet readers, live-DB verified)

Report: https://claude.ai/code/artifact/d04a18c5-7ecb-41e9-b73b-a7fed79f4736

- **Apify plan exhausted ~day 17.** `scraper_runs` showed 28 consecutive Reddit
  and 42 consecutive Twitter `skipped: apify_monthly_budget_exceeded` runs
  (Aug 6–19), recovering Aug 20 on cycle reset — two of five platforms dark for
  two weeks; watchdog criticals went unread. Reddit yielded 4.4 net-new
  posts/run. Applied: Reddit 1×/day × 20 posts/sub (`0 4 * * *`), Twitter
  2×/day (`6 4,16 * * *`), Mastodon unscheduled (83% of its classified posts
  irrelevant; 456 scored of 2,831 in 30d). Watchdog stale thresholds updated.
- **Classifier spend was ≈$28/mo, not the $8 on record** — 28,182 posts
  classified in 30d (~940/day) at the canary's $0.99/1k; 59% came back
  irrelevant (Mastodon 83%, Bluesky 72%, Twitter 62%, HN 50%, App Store 17%).
  Output tokens ≈73% of the bill. Anthropic spend (rumor extractor, 1,169
  posts/30d on Haiku) is under $1/mo.
- **OpenAI flex service tier** (`service_tier:"flex"`, 50% of standard; terra
  listed as supported) added as the production default via
  `OPENAI_SERVICE_TIER` (env, no redeploy to revert). Not in the rejected-ideas
  ledger: Batch API was rejected for needing a two-phase drain; flex needs
  none. Capacity 429 (`resource_unavailable`) and the 120 s flex timeout fall
  back to `service_tier:"auto"` for that request. NOT canary-validated with
  `json_schema` first — the fallback bounds the risk; verify via
  `classifier_usage_daily.service_tier='flex'` rows after deploy.
- **Token ledger**: `classifier_usage_daily` + `record_classifier_usage` RPC,
  written by the drain after every pass (prompt / cached / completion tokens
  per day × model × tier). The drain parsed this before and threw it away.
- Deleted: `run-pipeline`, `run-scrapers` (829 LOC, unscheduled), the Twitter
  `runGrokPath` (XAI_API_KEY never existed), `reclassify-posts` implicit
  "neutral" default mode (now 400 without `?mode=`), `classification_queue`
  (1,771 rows queued since May 7), `api_quota_usage` + `claim_api_quota`, 20
  orphan `scraper_config` rows with `scraper='reddit'`.
- Kept on purpose: `classifyBatch` + `BATCH_CLASSIFY_PROMPT` in
  `_shared/classifier.ts` — no production caller, but 15 provider/retry tests
  exercise the shared path through it.

## 2026-07-17 — Apify cost audit (live-measured, $29/mo Starter budget)

Trigger: suspected Reddit-actor price increase. Verdict: **no price increase** —
harshmaur/reddit-scraper's pay-per-event pricing was last changed 2026-04-07 and that
change was a *decrease* ("Reducing the costs further..."); store shows $0.02/GB actor
start + $0.0015–0.002/result tiered, apidojo/tweet-scraper flat $0.0004/tweet. The
squeeze is structural: steady-state spend ≈ $25/30d vs $29 of plan credits ($28
in-code guard), so any manual/debug runs ride the guard edge.

Live-measured economics (scheduler-body triggers, real runs):
- Reddit fan-out window (8 subs × 10 posts, 80 items): **$0.268/window**, ~60% of it
  actor-start fees (8 × ~$0.02). 2 windows/day (04:00/16:00 UTC) → ~$16.1/30d.
- Twitter (apidojo, 250 items × 3 runs/day at 04:06/12:06/21:06) → ~$9.0/30d.
- Billing cycle appears to start ~June 20 (matches secret-store verification date);
  mid-cycle reading was $24.74 with ~3 days left — fits steady state + manual runs.
- **`single_run: true` validation run: REJECTED.** One combined 8-subreddit run
  ($0.164) returned all 80 items from r/ClaudeAI — `maxPostsCount` is a sequential
  total cap and starved the other 7 subs, exactly the starvation the code comment
  feared. Do not enable `single_run_mode` with the harshmaur actor.
- Alternatives surveyed live via the Apify store API (July 17): Reddit —
  automation-lab/reddit-scraper (~$0.003 start + $0.00028–0.00115/post, but
  self-described "recovered" after Reddit blocked its prior paths and vote data
  often 0, which degrades the ln(upVotes+1) engagement weight in vibes-scoring);
  practicaltools/apify-reddit-api (official OAuth2, $0.002–0.004/item, 87.7%
  30-day success). Twitter — xquik/x-tweet-scraper ($0.15/1k, no run fee, small
  review base) vs apidojo ($0.40/1k, 68k users, battle-tested). trudax-lite
  confirmed still degraded (~68% 30-day success).
- Actionable levers if headroom is wanted (not applied this session): Reddit
  1×20/sub daily window instead of 2×10 (−$2.7/30d, same item volume, halved
  intraday freshness); smoke-test xquik for Twitter via a temporary helper fn
  (−$5.6/30d if it passes). Both need a Lovable-side config/cron change.

## 2026-07-10 — Sentiment-accuracy audit (Fable 5, 30-agent fan-out + blind re-judge)

Full-pipeline accuracy audit: 8 parallel code audits (classifier, scoring, each
scraper, keywords, live health, free sources) plus a blind regression — 120 live
classified posts re-judged blind by independent judges with every disagreement
adjudicated. Headline results:

- **Blind eval: 56/120 raw agreement, but 57 of the 64 disagreements were
  relevance leaks** (news digests, ads, passing mentions classified as sentiment),
  43 of them from Bluesky. Sentiment DIRECTION on genuinely relevant posts was
  ~89% accurate. Only 5 genuine sentiment flips survived adjudication.
- **Root cause of the Bluesky leak concentration: production was running
  pre-June-20 code.** Live `posts_found` ran 285–291/run — the old 12-term
  negative-fishing query list (12×25=300 cap) — while the repo's post-cf65318
  code caps at 125 (5 neutral terms × 25). The June 20 de-bias commit was never
  redeployed; shared-module changes (relevance prefilters, prompt tightening)
  likely also stale in every function not redeployed since. Fix: full redeploy
  + verify `posts_found ≤ 125` on the next Bluesky run.
- **Shipped same-day** (commit on `main`): classifier input cap 600→2000 chars,
  targeted-prompt drift re-sync + outage rule + implicit-target rule + neutral
  calibration, batch framing-token sanitization + `result_count_mismatch` guard,
  subreddit context prefix for reddit rows, neutral scored as 0.5 (was 0.3 —
  an all-neutral day scored 30), engagement weight floored at 1 and capped at
  ln(1001), failed-share >15% demotes a day to `partial_coverage`, HN comments
  + Ask-HN bodies ingestion, dead Mastodon phrase-search removed + per-model
  tech-instance hashtags, new free `scrape-appstore` source, Twitter
  `max_items` 80→250 (floor-billed tweets already paid for), keyword rows for
  shipped sub-model names, Reddit r/OpenAI→r/Bard net-zero swap.
- **Explicitly NOT changed** (documented decisions): smoothing EWMA (stability
  over responsiveness — revisit if launch events look muted), hourly raw scores,
  Reddit comment ingestion (still config-off; attribution fix exists in code via
  subreddit context but cost ~2.8× — revisit deliberately), Reddit budget guard
  still checks flat $0.35 planned (making it honest would over-block; flagged
  only), Discourse forums scraper (verified viable — community.openai.com,
  forum.cursor.com, discuss.ai.google.dev all serve anonymous search.json; the
  old scrape-discourse died on a DNS-dead forum list, not the approach — good
  next source if more volume is wanted).

## 2026-07-06 — Apify cost optimization (Fable 5, adversarially reviewed)

Demand was ~$30/mo against the $24/mo + $0.80/day fail-closed guards ($15 spent
mid-cycle), so late-day runs were being budget-skipped nondeterministically. Root
causes and fixes, all verified against actor pages + official Apify/Anthropic docs:

- **Twitter search terms consolidated 8 → 5** (`20260706120000`). apidojo bills a
  50-tweet minimum per query — 8 queries put the floor at $0.16/run, above the
  $0.15 `maxTotalChargeUsd` cap — and the actor documents a 5-batched-query max,
  so terms 6–8 were undocumented behavior (possibly silently unexecuted). New
  floor ~$0.10/run (~$4.5/mo saved at 3×/day). Cadence deliberately kept at
  3×/day: post-consolidation the 3rd run costs ~$2/mo and it's the 14:00 PT
  peak-US window (an earlier draft cut it — reversed as an over-cut on review).
- **Reddit `single_run_mode`** implemented behind a config flag (default off):
  one harshmaur run for all 8 subs would save 7×$0.02 start fees/window (~$8/mo).
  **Validation run 2026-07-06: NO-GO.** All 80 fetched items came from
  r/ClaudeAI (`per_subreddit_items: {ClaudeAI: 80}`, all 8 subs "SUCCEEDED",
  $0.164, ~56s) — the actor exhausts the total `maxPostsCount` cap on the
  first-listed subreddit even with comments off. Flag stays off permanently for
  this actor; code kept as telemetry + ready path for a per-URL-cap actor.
  Side effect: the validation ingested 83 genuinely-new r/ClaudeAI rows (one-time
  extra Claude Reddit volume in that day's sample; real in-window posts, left in).
- **Live budget guards are looser than the docs said**: env overrides
  `APIFY_MONTHLY_SPEND_LIMIT_USD=28` / `APIFY_DAILY_SPEND_LIMIT_USD=2` (seen in
  the run's `apifyBudget` block), not the in-code $24/$0.80 defaults — which is
  why no runs were ever budget-skipped. Post-plan demand ~$0.60/day ≈ $18/mo
  against the $28 guard and $29 plan; usage at validation time $15.73.
- **`check-gemini-self-bias` `DEFAULT_CANDIDATES` dropped Opus** — bare manual
  invocation could bill 300 posts × Opus with no spend cap.
- **Evaluated and rejected**: Anthropic Batch API (50% off ~$8/mo classifier,
  but two-phase drain rework + watchdog conflict at its 60-min backlog alert);
  prompt caching (inert on Haiku 4.5 — 4,096-token min cacheable prefix vs
  ~1,460-token instruction block); classify batch-size 20→40 (~$0.65/mo);
  `-filter:links`/date filters on Twitter queries (~$0 — the 50/query floor
  dominates billing while delivery sits under it); actor swaps (candidates
  logged in the plan; bake-off cost + preserve-working-scrapers).
- **Guards left at $0.80/day + $24/mo by design** — post-plan demand ~$0.66/day
  turns them into true backstops with same-day-retry headroom.
- Baseline audit (Lovable SQL, 14 days to 2026-07-06): Reddit $0.19–0.30/window
  (healthy; one ChatGPT sub-run FAILED 07-05). Twitter **80 charged items at
  ~$0.032/run** — apidojo bills DELIVERED items, not the 50/query minimum, which
  **refutes the floor-billing hypothesis**: Twitter was ~$2.9/mo (not the
  estimated ~$13.5/mo), the 8→5 consolidation is primarily the batch-cap
  data-quality fix rather than a dollar saving, and the `max_items` 80→150 bump
  is REJECTED (billing tracks delivery, so it would roughly double Twitter cost).
  Budget-skip count: **0 rows in 14 days** — the "guard already skipping runs"
  hypothesis was wrong for this window; real demand was ~$0.60/day (Reddit
  start-fees dominate). Per-model Twitter recall baseline for the week-1 watch:
  claude 712, grok 621, chatgpt 402, gemini 70 (gemini is the starvation
  canary in the merged query).

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
- **Post-deploy measurement:** the `fetch-vendor-status` in-memory cache never hits in
  production — verified via a `codeVersion` response marker (added specifically because
  Lovable deploys can't otherwise be distinguished from stale code) plus rapid-burst
  probes: the Supabase edge runtime did not reuse isolate module state across requests
  even on a pinned TCP connection. The cache stays in (harmless, and correct if the
  runtime ever changes) but provides no throttling; a real throttle would need shared
  state, which contradicts the function's no-DB/no-service-role design. Accepted.
- Watchdog fix verified live by direct scheduler-body invocation: 5 scrapers checked,
  zero staleness alerts; it immediately surfaced a real pre-existing signal instead:
  50 posts in failed classification state (at the >=50 alert threshold). Open
  follow-up: run `reclassify-posts?mode=reset_failed&error_pattern=transient`
  (dry_run=1 first) via the temporary-helper route to recover them.
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
