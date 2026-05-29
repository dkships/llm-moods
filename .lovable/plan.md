## End-to-end visual polish — second pass

I walked `/`, `/dashboard`, `/model/claude`, `/research`, and `/404` at desktop (1440) and mobile (390). The site is in strong shape after the last round — type ladder, sentiment colors, calm motion, and accessibility (44px GitHub target, skip link, focus rings) all hold up. This pass fixes the few real issues that remain.

### Critical

**1. Model cards have a large empty void (all surfaces)**
Landing, dashboard, and the card grid all show a tall blank gap between the score row and the "−N PTS · POSTS" line. The cause is the sparkline slot: `ModelCard` reserves an `h-12` sparkline block whenever `sparkline.length > 1`, but the line renders as empty space (no visible trend) — so every card carries ~90px of dead air, worst on mobile.
Fix: make the sparkline reliably visible (verify the Recharts series actually paints with the muted foreground stroke and a sensible Y domain), and collapse the reserved slot entirely when there is no usable multi-point series so cards stay compact instead of hollow.

### Polish

**2. NavBar wordmark wraps on mobile** (`NavBar.tsx`)
"LLM Vibes" breaks onto two lines at 390px. Add `whitespace-nowrap` (and `shrink-0`) to the wordmark so it stays on one line; let the nav links absorb the spacing.

**3. "Negative posts by surface" shows "Unknown 100%"** (`ModelDetail.tsx`)
When every negative post falls in the catch-all bucket, the panel renders a single meaningless "Unknown 100%" bar. Suppress the panel when the only row is "Unknown" (or when there's a single row that carries no real surface signal) — matches the project's asymmetric "only show caveats when meaningful" convention.

### Nice-to-have

**4. Research index trailing gap**
The 3-article grid leaves an empty cell in the last row. Low priority and only visible with an odd article count — leave as-is unless you want a subtle full-width treatment for the final card.

### Technical notes
- All changes are frontend/presentation only — no backend, RPC, or data changes.
- Card fix lives in `src/components/ModelCard.tsx` (and verify `src/components/Sparkline.tsx` renders); both Index and Dashboard consume the shared card, so one edit covers both.
- Reuse existing tokens/primitives (Surface, type ladder, sentiment colors) — no new colors or hand-rolled classes.
- Verify by re-screenshotting `/`, `/dashboard`, and `/model/claude` at desktop and mobile after the edits.

### Out of scope
Backend, classifier, scrapers, cron, RLS, dev-only routes, copy rewrites, new features.
