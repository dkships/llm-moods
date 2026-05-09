# LLM Moods (LLM Vibes)

@AGENTS.md

## Project Overview

Real-time AI sentiment dashboard tracking community vibes for 4 LLM models (Claude, ChatGPT, Gemini, Grok) across 5 social platforms. Scores models 0-100 daily based on scraped post sentiment.

**Live at:** llmvibes.ai (Lovable-hosted)

## Lovable Project

This is a Lovable-generated app synced bi-directionally with GitHub on `main`. The Supabase instance is created and managed entirely through Lovable — there is no independent Supabase account. When editing locally:
- Push to `main` → Lovable auto-syncs frontend (other branches don't sync)
- **Edge Function deploys require a Lovable-side trigger** — pushing to `main` syncs the code but may not redeploy edge functions automatically. Give the user a Lovable chat prompt to trigger redeployment.
- Never suggest `supabase` CLI commands or Supabase dashboard steps — the user has no direct Supabase access
- Avoid restructuring directories or renaming files that Lovable manages
- Don't edit auto-generated files: `src/integrations/supabase/types.ts`, Lovable OAuth bridge files
- `lovable-tagger` dev dependency is required for Lovable's visual editor — don't remove
- Never enter API keys directly in Lovable — use Supabase Edge Function secrets or Lovable Cloud secrets

### Edge function auth gates: keep them

Edge functions that hit paid APIs (Gemini, Apify, etc.) MUST keep their `isInternalServiceRequest` gate. The repo and the anon key are public, so an ungated function is a public quota-burner. This came up in Phase 10B when Lovable's curl tool removed the gate from `reclassify-posts` to invoke it (the tool sends user JWT, not service-role) — Phase 11B re-added the gate after a $0.01-per-call attack vector was identified.

If a one-shot reclassify or backfill is needed, the supported invocation path is a **temporary helper edge function**, not raw SQL:

1. Create an ephemeral edge function (slug must NOT start with underscore) that reads `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env` and forwards a Bearer-authenticated POST to the gated function (e.g. `reclassify-posts?mode=multi_model`).
2. Invoke the helper via Lovable's `curl_edge_functions` (which sends user JWT, but the helper itself uses the service-role key for the downstream call).
3. Delete the helper from the deployed function list after the run completes.

**Why not raw SQL:** `current_setting('app.settings.service_role_key', true)` returns NULL in this Supabase environment, and Vault is empty. Pg_cron jobs get away with using the anon key only because their target endpoints (`run-scrapers`, `aggregate-vibes`, `cleanup-old-posts`) are intentionally ungated. The service-role key lives only in the edge-function runtime — verified Phase 12.

Do NOT remove the application-layer gate from these functions to work around invocation friction.

Functions that should stay gated: `reclassify-posts`, anything else that calls Gemini/Apify or performs unbounded writes.

Functions safe to leave ungated (called by pg_cron with anon key): `aggregate-vibes`, `reaggregate-vibes`, `cleanup-old-posts`, `run-scrapers`. Their operations are bounded and idempotent; an attacker hammering them can't escalate beyond what's already exposed via the public REST API.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18.3 + TypeScript 5.8 |
| Build | Vite 5.4 (SWC plugin) |
| Routing | React Router 6.30 (lazy-loaded pages) |
| UI | shadcn/ui (Radix + Tailwind 3.4) |
| Charts | Recharts 2.15 |
| State | TanStack React Query 5.83 |
| Animations | Framer Motion 12.35 |
| Backend | Supabase (PostgreSQL + Edge Functions) |
| Edge Functions | 11 Deno functions (5 active scrapers + utilities) |
| Sentiment AI | Gemini 2.5 Flash via Google AI API (batch classification, 25 posts/call) |

## Key Routes

- `/` — Landing page (hero + model preview grid)
- `/dashboard` — All models with scores, trends, sparklines, chatter feed
- `/model/:slug` — Model detail (history chart, complaint/source breakdown, posts, vendor events overlay, recent-incident card, official status card with anomaly correlation, surface-tagged recent posts)
- `/research` — Research index (long-form articles index)
- `/research/:slug` — Research article (live embedded charts via `chart-model` markdown sentinel; first article ships with CSV download + Dataset JSON-LD)
- `/admin/scrapers` — Scraper run monitor + score anomalies panel. **Dev-only** (gated on `import.meta.env.DEV`; production bundles physically exclude the chunk).
- `/og/:slug` — Dev-only OG card preview at fixed 1200×630 for capturing per-article share images.

## Database Schema

| Table | Purpose |
|-------|---------|
| `models` | Tracked LLM models (slug, name, accent_color) |
| `scraped_posts` | Raw posts with sentiment + complaint classification + translation |
| `vibes_scores` | Aggregated daily/hourly scores (0-100) |
| `model_keywords` | Keyword → model matching for scrapers |
| `scraper_config` | Runtime scraper settings (subreddits, etc.) |
| `scraper_runs` | Audit log per scraper execution |
| `error_log` | Debug error tracking |

**RPC Functions:** `get_landing_vibes()`, `get_sparkline_scores()`, `get_complaint_breakdown()`, `get_source_breakdown()`, `get_trending_complaints()`

## Cron architecture (May 2026)

The pipeline runs as 7 independent pg_cron rows, each within its own 400 s edge-function budget. No orchestrator. Migration: `20260508183000_decompose_pipeline_to_independent_crons.sql`.

| Cron | Schedule (UTC) | PT | Function |
|---|---|---|---|
| `scrape-reddit-apify-3x` | `0 4,12,21 * * *` | 21/05/14 | `scrape-reddit-apify` |
| `scrape-hackernews-3x` | `2 4,12,21 * * *` | +2 min | `scrape-hackernews` |
| `scrape-bluesky-3x` | `4 4,12,21 * * *` | +4 min | `scrape-bluesky` |
| `scrape-twitter-3x` | `6 4,12,21 * * *` | +6 min | `scrape-twitter` |
| `scrape-mastodon-3x` | `8 4,12,21 * * *` | +8 min | `scrape-mastodon` |
| `drain-classifications-q30` | `*/30 * * * *` | every 30 min | `drain-classification-queue` |
| `aggregate-vibes-q30` | `15,45 * * * *` | every 30 min, offset | `aggregate-vibes` |

The May 8 "simplified pipeline rebuild" (`20260508120000`) merged scrape+classify+aggregate into a single `run-pipeline` function — that cannot fit in 400 s and silently froze scores until this decomposition. `run-pipeline` and `run-scrapers` remain in code as manual debug tools but are not scheduled.

Scraper auth gates accept three callers: service-role JWT, `RUN_PIPELINE_TRIGGER_SECRET` header, or anon JWT with body `{scheduler:"pg_cron", pipeline:"scrape-..."}`. Adding the third path is what lets pg_cron invoke each scraper directly without leaking service-role into a public-repo migration.

## Known reliability issues

- **`scrape-reddit-apify` fails ~57%** of recent windows. The `trudax~reddit-scraper-lite` Apify actor times out or returns 0 items intermittently. Investigate before relying on Reddit-only signals.

## Scrapers (Edge Functions)

Reddit (Apify), Hacker News (Algolia API), Bluesky (AT Protocol), Twitter/X (Apify), Mastodon (public API, 5 instances). Lemmy was dropped in Phase 12 (yielded 0.4 posts/run for 18 wasted Gemini calls; mostly Reddit cross-posts). Each scraper runs on its own pg_cron row at the three Pacific-time windows (05:00, 14:00, 21:00 PT), staggered by minute — see "Cron architecture" above. Scrapers insert posts as `classification_status='pending'`; classification is drained by the separate `drain-classification-queue` cron, and `aggregate-vibes` runs independently to refresh scores.

Shared utilities (keyword matching, dedup, error logging) are in `_shared/utils.ts` — scrapers import from there instead of duplicating code.

Sentiment classified via Google Gemini API (`generativelanguage.googleapis.com`) using `gemini-2.5-flash` (stable GA — moved off `gemini-3.1-flash-lite-preview` on 2026-04-25 after Google rotated the preview snapshot to a more conservative version that flagged 100% of posts as irrelevant). Single-model posts use `classifyBatch()` (25 posts/call). Multi-model posts (mentioning 2+ models) use `classifyBatchTargeted()` for per-model sentiment — e.g., "DeepSeek fixed Gemini's mess" is negative for Gemini, positive for DeepSeek. Both functions are in `_shared/classifier.ts`. Classifier has 429 retry logic (3 attempts with exponential backoff) and 2s inter-batch delay. Non-English posts are translated to English by the classifier prompt (no extra API calls); original text stored in `content`, translation in `translated_content`, language code in `original_language`. Known limitation: Gemini classifies posts about itself (potential self-bias). Gemini free tier is ~1,000 RPD (resets midnight Pacific Time). At 3x/day with ~24 calls/run (~72 calls/day including targeted batches) — well within limits.

`reclassify-posts` edge function supports `?mode=multi_model` to find and fix historical multi-model posts with identical sentiment. Run `reaggregate-vibes` after to recalculate scores.

**Reddit scraper** uses `trudax~reddit-scraper-lite` Apify actor. Fetches from 5 subreddits (ClaudeAI, ChatGPT, LocalLLaMA, GoogleGemini, artificial), maxItems 40.

**Twitter/X scraper** uses `apidojo~tweet-scraper` Apify actor with `searchTerms` array input (4 terms, maxItems 50). Has a dormant Grok/xAI fallback path (requires `XAI_API_KEY`). Apify budget: $29/month, used for Reddit and Twitter.

**Tracked models:** Claude, ChatGPT, Gemini, Grok (DeepSeek and Perplexity were removed 2026-03-21).

## Frontend patterns added in 2026

- **Vendor events overlay on charts:** `src/data/vendor-events.ts` exports `VENDOR_EVENTS[]` (typed-TS, frontend-only). `VibesChart` accepts an optional `events` prop and renders Recharts `<ReferenceArea>` / `<ReferenceLine>` for each one. Used to mark Anthropic / OpenAI / Google / xAI bug windows, model launches, and postmortems.
- **Per-model product surface tagging:** `src/lib/product-surface.ts` carries a per-model regex map (e.g. Claude → Claude Code / Claude.ai / API / SDK). Display-only — applied client-side to recent posts; no schema change.
- **Anomaly detection:** `src/hooks/useScoreAnomalies.ts` runs a 14-day rolling z-score in the browser over `vibes_scores`. Surfaced in the dev-only `/admin/scrapers` Anomalies panel and cross-referenced against Official Status events on `/model/:slug` via `src/lib/status-correlation.ts`.
- **Official Status integration:** `supabase/functions/fetch-vendor-status` parses Anthropic + OpenAI Atom feeds and Google Cloud incidents.json, returns the last 30 days. `useVendorStatus()` + `<StatusCard />` render the result in the left column under the chart for all four model pages. xAI shows a "no public status feed" empty state.
- **Research articles:** `src/data/research-posts.ts` carries typed-TS `ResearchPost` entries with markdown bodies. The body's ```chart-model``` fenced code block is intercepted by `src/components/research/EmbeddedModelChart.tsx` and replaced with a live model chart. Article + Dataset JSON-LD emitted via the extended `useHead.jsonLd` field. `src/components/research/AuthorBio.tsx` is the single source of truth for David's bio + contact links — its `BIO_LINKS` array drives every article's footer; update there, not per-article. `src/components/research/PullQuote.tsx` styles verbatim social-post citations (handle / platform / timestamp meta + optional `archivedHref` for Wayback backups); use in place of `<blockquote>` when the quote is load-bearing evidence.
- **OG image generator:** `src/pages/OgPreview.tsx` (dev-only `/og/:slug`) renders a 1200×630 card; we capture screenshots into `public/research/<slug>/og.png` and reference via `ResearchPost.ogImage`. Colors are pinned in a top-of-file `OG_THEME` constant — intentionally decoupled from runtime CSS vars (capture path is fragile across viewport changes); update by hand and re-capture if the runtime palette shifts.
- **Shared design primitives (Apr 2026 polish pass, PRs #5/#7):** `src/components/Surface.tsx` is the canonical card wrapper around the `glass` utility (sizes `default | compact | tight | bare`, `tone="accent"` for the left-border highlight, `motion="fade"` opts in to `animate-fade-in`, calm `hover:border-border/80` baked in). `src/components/FilterChip.tsx` (rect or pill) replaces ad-hoc filter buttons. `src/components/SectionHeader.tsx` and `src/components/PageHeader.tsx` standardize H2/H1 markup. Use these instead of writing `glass rounded-xl p-6` inline. Sentiment colors derive from the single `SENTIMENT_HSL` constant in `src/lib/vibes.ts`; do not reintroduce hex literals or palette classes (`#EF4444`, `text-red-200`, etc.) for sentiment states. Aesthetic direction is restraint — one page-level fade per render, no per-section staggers, single calm border-color hover.
- **Asymmetric data-quality warnings:** sample-size and freshness caveats appear *only* when something is off — silence implies the data is fine. The two patterns: carry-forward days render a dashed hollow dot on charts plus a `Carry-forward — 0 posts scraped` tooltip line (`src/components/VibesChart.tsx`). Days with `vibes_scores.eligible_posts < LIMITED_SAMPLE_THRESHOLD` (=5, in `src/lib/vibes.ts`) render a `Limited sample today` note below the description on `/model/:slug` and a parallel `Limited sample — N high-confidence posts` line in chart tooltips. No equivalent chip on dashboard cards — the existing 7d post count is enough volume signal at scan depth.

**Edge Function deployment:** Pushing to `main` triggers Lovable auto-sync for frontend. Edge Functions require a Lovable-side redeploy — prompt Lovable to sync from GitHub and redeploy the affected functions. Do not use `supabase` CLI (no independent Supabase account exists).

## Environment Variables & Secrets

**Frontend (VITE_ prefix):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — public anon credentials, hardcoded as fallbacks in `src/integrations/supabase/client.ts`. Safe to expose (RLS enforces security).
- `.env` is gitignored; `.env.example` has placeholder structure for local overrides.

**Edge Functions (Supabase secrets — never commit these):**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY` — Google AI API key for sentiment classification (all scrapers)
- `LOVABLE_API_KEY` — Lovable AI gateway key (no longer used by scrapers, kept for Lovable platform)
- `APIFY_API_TOKEN`, `BSKY_HANDLE`, `BSKY_APP_PASSWORD`
- `MASTODON_URL`, `MASTODON_TOKEN`
- `DISCOURSE_INSTANCE`, `DISCOURSE_API_KEY`, `GITHUB_TOKEN`
- Dormant (for removed scrapers): `LEMMY_INSTANCE_URL`

**Security notes:**
- Repo is **public** on GitHub — never commit service role keys, API tokens, or passwords
- `.gitignore` uses `.env*` glob with `!.env.example` whitelist
- All tables have RLS enabled; anon key can only SELECT (no write policies)
- All edge functions use service role key via `Deno.env.get()`, never hardcoded

## Development

```bash
npm run dev          # Vite dev server (localhost:8080)
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest
```

## Code Patterns

- **Memoization:** `memo()` on model cards and list items
- **Lazy loading:** Routes, Recharts, Sparkline components
- **Prefetching:** Hover on model cards prefetches detail data
- **React Query:** 60s stale time for most queries, 30s for scraper monitor
- **Infinite scroll:** Chatter posts (25/page cursor-based on `posted_at`)
- **Sentiment scale:** 0-40 bad (red), 41-65 mixed (amber), 66-100 good (green) — colors flow through `SENTIMENT_HSL` in `src/lib/vibes.ts`
- **Muted text convention:** `text-foreground` for primary statements / scores / headings, `text-text-secondary` for body, `text-text-tertiary` for meta / captions / labels. Avoid arbitrary `text-foreground/{60..90}` opacities in new code (Tailwind aliases live in `tailwind.config.ts`).
- **Head management:** `useHead` hook (`src/hooks/useHead.ts`) sets per-route title, description, OG tags, and canonical URL by mutating existing `<head>` tags in `index.html`
- **Sitemap:** `public/sitemap.xml` is static — update manually when adding/removing tracked models

## Known Limitations

- TypeScript config is loose (`strictNullChecks: false`, `noImplicitAny: false`)
- `/admin/scrapers` is public — no auth required
- All Edge Functions have `verify_jwt = false`
- Sentiment classification prompt is centralized in `_shared/classifier.ts` (batch + single)
- Minimal test coverage (example test only)
- Error handling in scrapers silently logs to `error_log` table

## Accuracy Guardrails

- If uncertain about a scraper API, Supabase schema, or edge function behavior, say "I don't know" rather than guessing
- Read the relevant source file before making claims about scraper logic, classifier behavior, or database schema
- Verify that Supabase tables, RPC functions, and edge functions exist before referencing them
- Do not suggest Deno/Supabase features without verifying they are available in this project's edge function runtime
- When referencing scraper configurations or API integrations, verify against `supabase/functions/` source files
- Cite specific file paths when making recommendations
- When analyzing scraper data, sentiment results, or edge function output, extract direct quotes and specific numbers first, then base conclusions on those — not on memory or paraphrase
- After generating claims or recommendations, self-verify each against the source material; retract any claim that lacks a supporting code reference or data point

## Working Here with Claude Code

Focus areas for local edits:
- Bug fixes in frontend components (`src/components/`, `src/pages/`)
- Query logic in `src/hooks/useVibesData.ts`
- Scraper logic in `supabase/functions/`
- Constants/labels in `src/lib/vibes.ts`
- Database migrations in `supabase/migrations/`

Don't modify: `src/integrations/supabase/types.ts` (auto-generated), `src/components/ui/` (shadcn managed)

Always commit after completing work — don't leave a dirty branch on `main` (Lovable syncs from it).
