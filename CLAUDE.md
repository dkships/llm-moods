# LLM Moods (LLM Vibes)

@AGENTS.md

Real-time AI sentiment dashboard for 4 LLM models across 5 social platforms; live at llmvibes.ai (Lovable-hosted). Reference docs: stack/routes/schema/cron tables in `docs/architecture-reference.md`; deep operational detail (classifier, scrapers, rumors pipeline, frontend catalog) in `AGENT-REFERENCE.md`; audit records in `OPERATIONS-HISTORY.md`.

## Lovable Workflow

Beyond the AGENTS.md rules:
- **Finish the job yourself via the Lovable MCP — never hand David manual Lovable steps.** He has standing authorization for the full path: push to `main`, then publish and verify. Do not end a turn with "paste this into Lovable chat" or "click Publish"; that is the failure mode this rule exists to kill.
- **Push without being asked**: after a change builds (`npm run build`), commit AND push to `main` — Lovable only syncs from `main`, so unpushed work is invisible to David.
- **Publishing is a separate step from syncing, and a push alone does NOT reach llmvibes.ai.** Sequence:
  1. Push to `main`.
  2. Confirm Lovable synced: `mcp__lovable__list_projects` → `latest_screenshot_url` embeds the commit sha (`id-preview-<sha>--...`).
  3. `mcp__lovable__deploy_project` with **only** `project_id` (`94f104f7-b72c-4dc6-b12d-e84aa593cba4`) — passing `name` rewrites the published slug. Goes live in ~45 s vs ~25-40 min of waiting for auto-deploy.
  4. Verify by hash equality, not by eyeballing: `curl -s https://llmvibes.ai/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.\(css\|js\)'` must match `ls dist/assets/index-*`. Lovable's build is byte-reproducible against a local `npm run build`. Never verify against `id-preview--<project_id>` — it serves a different, smaller build.
- **Migrations and ad-hoc SQL go through `mcp__lovable__query_database`** (supports DDL and writes), not a chat prompt. Dry-run reads first; a write against production is permanent.
- Edge Function deploys still need `mcp__lovable__send_message` — but that tool has a verified stale-response bug (returns a byte-identical cached reply and has falsely claimed success). Never trust its return value: confirm via `list_messages` plus the actual observable state (a `codeVersion` marker in the function response, or `cron.job` rows).
- Avoid restructuring directories or renaming files Lovable manages. Don't edit `src/components/ui/` (shadcn-managed) or remove the `lovable-tagger` dev dependency.
- Never enter API keys directly in Lovable — use Supabase Edge Function secrets.

## Development

```bash
npm run dev    # Vite dev server (localhost:8080)
npm run build  # prebuild runs `tsx scripts/generate-rss.ts` first
npm run lint   # ESLint
npm run test   # Vitest
```

## Edge function auth gates: keep them

Edge functions that hit paid APIs (Anthropic, Apify, Gemini, etc.) MUST keep their `isInternalServiceRequest` gate. The repo and the anon key are public, so an ungated function is a public quota-burner. Do NOT remove an application-layer gate to work around invocation friction.

- Stay gated: `reclassify-posts` and anything that calls Anthropic/Gemini/Apify or performs unbounded writes. `aggregate-vibes`, `cleanup-old-posts`, `run-scrapers` accept service-role JWT **or** the pg_cron scheduler body `{scheduler:"pg_cron", pipeline:"<source>"}`; `reaggregate-vibes` requires service-role; bare anon gets 403.
- Scraper gates accept three callers: service-role JWT, `RUN_PIPELINE_TRIGGER_SECRET` header, or anon JWT with the pg_cron scheduler body (lets pg_cron invoke scrapers without leaking service-role into a public-repo migration).
- One-shot invocations of gated functions go through a temporary helper edge function, never raw SQL — procedure and gate history in `AGENT-REFERENCE.md`.

## Pipeline (pg_cron)

- Independent pg_cron rows, no orchestrator, each within its own 400 s edge-function budget. Full cron table: `docs/architecture-reference.md`. Live cron diverges from migration history — check `cron.job` for actual state.
- `run-pipeline` / `run-scrapers` are unscheduled manual debug tools (the merged pipeline blew the 400 s budget).
- Recover transient classification failures: `reclassify-posts?mode=reset_failed&error_pattern=transient` (confirm with `dry_run=1` first). `reclassify-posts?mode=multi_model` fixes historical multi-model posts; run `reaggregate-vibes` after.
- Reddit actor is config-driven (`scraper_config.actor_id`), currently `harshmaur/reddit-scraper`. Don't revert to `trudax/reddit-scraper-lite` — it used Reddit's public `.json` API, dead (403) since May 2026.

## Classifier & scraper invariants

Read `AGENT-REFERENCE.md` before changing `_shared/classifier.ts` or any scraper. Invariants that must hold:
- Classifier model is a pure config flip via `CLASSIFIER_MODEL` (claude-* → Anthropic, gpt-* → OpenAI, else Gemini; keys `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`). Production model is `gpt-5.6-terra` as of 2026-08-08 (canary: 94.7% sentiment agreement vs Gemini oracle; Luna ran briefly first) — rollback = `CLASSIFIER_MODEL=claude-haiku-4-5-20251001` or `gemini-2.5-flash` (no redeploy, all providers stay live)
- Strict tool use (`strict:true`) stays OFF — nullable-union schema 400s under the structured-output subset (verified in prod 2026-06-02)
- Reddit comment ingestion stays disabled (`include_comments=false`) until a comment→parent-post attribution fix exists
- `maxTotalChargeUsd` is the authoritative Apify cost cap ($29/mo budget; in-code guard in `_shared/apify-budget.ts`)
- There is no `GEMINI_FREE_API_KEY` — spillover and the self-bias oracle use the paid `GEMINI_API_KEY` (billing must stay active)

## Rumors radar (`/rumors`)

Pipeline detail is in `AGENT-REFERENCE.md`; read it before touching anything rumor-related. Recurring manual touch: refresh the codename/next-version `model_keywords` rows and the `FAMILY_ALIASES` + `COMPETITOR_DENY` seeds in `_shared/rumor-canon.ts` each cycle. The extractor's released-set prompt is generated from `FAMILY_ALIASES`. To hide a just-launched model instantly with zero backend deploy, set `released: true` on its alias entry. ETAs are always framed as unconfirmed community estimates, never forecasts.

## Ship Sense benchmark (`/benchmark`)

`.github/workflows/sync-ship-sense.yml` polls github.com/dkships/ship-sense daily, regenerates the snapshot, and **pushes to `main` on its own** — expect bot commits touching `src/data/ship-sense-{snapshot,teaser}.ts` and `public/benchmark/og.png`, and always `git fetch` before local edits. It verifies with lint + test + build before pushing.

- Those three files are generated. Edit `scripts/sync-ship-sense.ts` (derivation, ported from ship-sense `src/leaderboard.py`) or `src/data/ship-sense.ts` (types + prose helpers) instead; `npm run sync:shipsense` regenerates locally, `-- --dry-run` reports without writing.
- Everything the page renders is derived, including the scored-window eyebrow and the provenance sentence. Don't reintroduce hand-copied counts, dates, or model names — they defeat the unattended sync. Same for the tests: assert internal consistency, never a model count.
- A new run_id or version does **not** auto-push; the workflow opens an issue, because a re-scored bank can change the README-sourced copy this repo keeps by hand (`SHIP_SENSE_DIMENSIONS`, the method/limitations paragraphs). Re-run with `force` to push anyway.
- Scoring dates are reconstructed from `price_verified` (Ship Sense verifies prices at scoring time) — see `scoringDates()` in `scripts/ship-sense-derive.ts`. If it ever disagrees with the ship-sense README, the README wins.

## Frontend design rules

Full pattern catalog (vendor events overlay, surface tagging, anomaly detection, status integration, research-article system, prerender/OG pipeline, primitive APIs) is in `AGENT-REFERENCE.md` — read the relevant entry before touching those areas. Always-on rules:

- Use the shared primitives, don't re-inline: `Surface.tsx` (card wrapper), `FilterChip.tsx`/`Tag.tsx` (the only two pills), `ModelCard.tsx`, `ChatterPost.tsx`, `SectionHeader.tsx`/`PageHeader.tsx`, `BarList.tsx`.
- **Type ladder** is 8 rungs (`hero / score-xl / score / page / section / body / meta / mono-cap`, in `src/index.css`) — pick a rung, never hand-rolled `text-[Npx]` / `text-lg` / `text-xs uppercase tracking-wide`.
- **Sentiment colors** derive only from `SENTIMENT_HSL` in `src/lib/vibes.ts` — no hex literals or palette classes.
- **Muted text**: `text-foreground` for primary/scores/headings, `text-text-secondary` for body, `text-text-tertiary` for meta — no arbitrary `text-foreground/{60..90}` opacities in new code.
- **Accent (primary) hue** is reserved for chart stroke, hero "bad day" glow, NavBar, and the TrendingComplaints %-change number. Severity/staleness read through `--destructive`/`--warning` *tints* with neutral text. The research-article surface is a deliberate editorial exception — don't neutralize it.
- Aesthetic direction is **restraint**: one page-level fade per render, no per-section staggers, single calm border-color hover.
- Data-quality warnings are **asymmetric** — shown only when something is off; silence implies the data is fine.
- New public routes must be added to the `scripts/prerender-routes.ts` route table AND `public/sitemap.xml` (static — also update it when tracked models change); social shares must use the literal `.html` path form (Lovable host quirk).

## Secrets

- Edge-function secret store (verified 2026-06-20) is exactly: `CLASSIFIER_MODEL`, `ANTHROPIC_API_KEY`, `RUN_PIPELINE_TRIGGER_SECRET`, `GEMINI_API_KEY`, `APIFY_API_TOKEN`, `BLUESKY_APP_PASSWORD`, `BLUESKY_HANDLE`, `LOVABLE_API_KEY`, plus `OPENAI_API_KEY` (added 2026-08-08 for the GPT-5.6 classifier). No `MASTODON_*`, `DISCOURSE_*`, `GITHUB_TOKEN`, or `LEMMY_*` — those integrations are inert (Mastodon uses public endpoints).
- Frontend `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are public anon creds, hardcoded as fallbacks in `src/integrations/supabase/client.ts` — safe to expose.

## Accuracy

Before claiming scraper/classifier behavior, check the `_shared/` modules — many features moved out of per-scraper files.
