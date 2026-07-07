# LLM Moods (LLM Vibes)

@AGENTS.md

Real-time AI sentiment dashboard for 4 LLM models across 5 social platforms; live at llmvibes.ai (Lovable-hosted). Reference docs: stack/routes/schema/cron tables in `docs/architecture-reference.md`; deep operational detail (classifier, scrapers, rumors pipeline, frontend catalog) in `AGENT-REFERENCE.md`; audit records in `OPERATIONS-HISTORY.md`.

## Lovable Workflow

Beyond the AGENTS.md rules:
- **Push without being asked**: after a change builds (`npm run build`), commit AND push to `main` — Lovable only syncs from `main`, so unpushed work is invisible to David. Tell him it's pushed and whether an edge-function redeploy prompt is needed.
- Edge Function deploys require a Lovable-side trigger — pushing to `main` syncs code but may not redeploy. Give David a Lovable chat prompt to trigger redeployment.
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
- Classifier is Claude Haiku 4.5; a model swap is a pure config flip via `CLASSIFIER_MODEL` — rollback = `CLASSIFIER_MODEL=gemini-2.5-flash` (no redeploy, both providers stay live)
- Strict tool use (`strict:true`) stays OFF — nullable-union schema 400s under the structured-output subset (verified in prod 2026-06-02)
- Reddit comment ingestion stays disabled (`include_comments=false`) until a comment→parent-post attribution fix exists
- `maxTotalChargeUsd` is the authoritative Apify cost cap ($29/mo budget; in-code guard in `_shared/apify-budget.ts`)
- There is no `GEMINI_FREE_API_KEY` — spillover and the self-bias oracle use the paid `GEMINI_API_KEY` (billing must stay active)

## Rumors radar (`/rumors`)

Pipeline detail is in `AGENT-REFERENCE.md` — read it before touching anything rumor-related. Recurring manual touch: refresh the codename/next-version `model_keywords` rows each cycle, alongside `RELEASED_SET` in `aggregate-rumors/index.ts` and the `FAMILY_ALIASES` + `COMPETITOR_DENY` seeds in `_shared/rumor-canon.ts`. To hide a just-launched model instantly with zero backend deploy, set `released: true` on its `FAMILY_ALIASES` entry. ETAs are always framed as unconfirmed community estimates, never forecasts.

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

- Edge-function secret store (verified 2026-06-20) is exactly: `CLASSIFIER_MODEL`, `ANTHROPIC_API_KEY`, `RUN_PIPELINE_TRIGGER_SECRET`, `GEMINI_API_KEY`, `APIFY_API_TOKEN`, `BLUESKY_APP_PASSWORD`, `BLUESKY_HANDLE`, `LOVABLE_API_KEY`. No `MASTODON_*`, `DISCOURSE_*`, `GITHUB_TOKEN`, or `LEMMY_*` — those integrations are inert (Mastodon uses public endpoints).
- Frontend `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are public anon creds, hardcoded as fallbacks in `src/integrations/supabase/client.ts` — safe to expose.

## Accuracy

Before claiming scraper/classifier behavior, check the `_shared/` modules — many features moved out of per-scraper files.
