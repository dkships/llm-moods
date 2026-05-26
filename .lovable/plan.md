# End-to-end visual & UX polish audit

## Goal
Walk every public surface of llmvibes.ai at desktop and mobile widths, screenshot each, and produce a prioritized list of polish opportunities — type, spacing, color, hierarchy, motion, responsive behavior, accessibility, and consistency against the design system documented in AGENTS.md (8-rung type ladder, Surface primitive, Tag/FilterChip, sentiment color tokens, single page-level fade, restraint).

No code changes in this pass — output is a written audit + ranked backlog. You then pick what to fix.

## Surfaces to review
1. `/` — landing (hero + 4 model cards + "how it works")
2. `/dashboard` — all models, sparklines, chatter feed, trending complaints, staleness banner
3. `/model/:slug` — pick 2 (one healthy, one with anomalies/limited sample) to cover chart, vendor events, status card, complaint/source bar lists, recent posts, surface tags, "abandoned" chip
4. `/research` — index
5. `/research/:slug` — pick 1 long-form article (embedded chart, pull quote, stat callout, author bio)
6. `/404`
7. Global: NavBar, Footer, skip link, focus states, reduced motion

## Method
For each surface:
1. Screenshot at desktop (1440) and mobile (390) via browser tools
2. Crop into hero, mid, and footer regions where useful
3. Note issues against these checklists:
   - **Type ladder** — any `text-lg/xl/2xl/3xl`, hand-rolled `text-[Npx]`, or `text-xs uppercase tracking-wide` drift outside the 8 rungs
   - **Color tokens** — any raw hex, `text-foreground/{60..90}` opacities, or non-sentiment use of accent hue
   - **Spacing rhythm** — inconsistent card padding, gap, section vertical rhythm
   - **Hierarchy** — scan-depth clarity: what's the first thing the eye lands on, is it the right thing
   - **Density** — empty space vs cramped zones, especially mobile
   - **Consistency** — Surface vs hand-rolled `glass rounded-xl`, Tag vs raw Badge, FilterChip vs ad-hoc buttons, ModelCard / ChatterPost reuse
   - **Motion** — single page fade only, no per-section stagger, calm hover
   - **Accessibility** — alt text, aria-labels on icon buttons, focus-visible rings, 44px tap targets on mobile, heading order, `h-dvh` over `h-screen`
   - **Responsive** — overflow, wrap behavior, chart legibility, sticky/banner stacking
   - **Editorial register** — research surface keeps its accent links / blockquote rule (intentional), dashboard stays calm

## Deliverable
A single written audit grouped by severity:
- **Critical** (broken, inaccessible, or off-brand)
- **Polish** (clear improvement, low risk)
- **Nice-to-have** (subjective taste calls)

Each item: surface · what · why it matters · suggested fix (one line). No code written this pass. After you read it you pick which items to send back as build tasks.

## Out of scope
- Backend, classifier, scrapers, cron, RLS
- Dev-only routes (`/admin/scrapers`, `/og/:slug`)
- Copy rewrites beyond obvious typos
- Adding new features
