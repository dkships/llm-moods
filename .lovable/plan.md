# Visual Polish Pass — Mobile Hero + Micro-Refinements

## Audit summary
Reviewed all routes at 1440px and 390px with fixed-viewport captures: `/`, `/dashboard`, `/model/:slug`, `/research`, `/rumors`, `/privacy`. The site is already cohesive and well-crafted — the type ladder, sentiment colors, and restraint contract are applied consistently. I'm deliberately **not** churning the pages that already work. One real defect and two small refinements are worth doing.

## 1. Mobile hero dead zone (primary fix)
**Problem:** On mobile the hero uses `min-h-[calc(100svh-3.5rem)]` with `flex items-center`, so the headline is vertically centered in a full-height viewport — leaving ~40% of the screen empty above "Is your AI having a bad day?" The vibe gauge we added is desktop-only (`hidden lg:flex`), so mobile gets the void with nothing to anchor it.

**Fix — give mobile the same focal payoff as desktop:**
- Make `HeroVibeGauge` responsive: accept a `size` (or use a compact ~200px variant) so it works at small widths. Font rungs and stroke scale down proportionally.
- Show a compact gauge on mobile **above** the headline, centered, so the hero reads top-to-bottom as: gauge → headline → tagline → CTA → tagline row. This fills the space purposefully and answers the "bad day?" question instantly on mobile too.
- Reduce the mobile hero from full-`svh` centering to top-aligned with balanced padding (`pt-10`/`pt-12`), so content sits high and the section height is content-driven, not a forced full screen. Desktop layout (`sm:` and up) is unchanged — the gauge stays in the right column there.

**Net:** mobile hero becomes a centered, single-column composition with a live gauge; no empty top band. Desktop untouched.

## 2. Rumors card height alignment (small)
On desktop the two rumor cards render at different heights (the taller card sets the row, the shorter one leaves trailing space). Add `items-start` is already fine, but make the cards equal-height within a row (`h-full` on the card surface) so the row reads as a tidy pair rather than mismatched blocks. Purely presentational; no data change.

## 3. Hero glow alignment with the gauge (small)
The ambient radial glow currently sits behind the (now-occupied) right column but is centered slightly off from the gauge. Nudge the primary glow to sit concentric with the gauge on `lg` so the glow reads as the gauge's halo rather than a stray blob. On mobile, position a smaller glow behind the compact gauge.

## What I am intentionally leaving alone
- Dashboard "Recent community chatter" list, trending complaints, model detail charts/breakdowns, research grid, privacy page — all consistent and legible; changing them would add churn without clear benefit.
- Color palette stays (dark theme, sentiment green/amber/red). No token changes.

## Technical
- `src/components/HeroVibeGauge.tsx`: add responsive sizing (prop-driven diameter + proportional stroke/typography); keep colors from `getVibeStatus`/`SENTIMENT_HSL` and the reduced-motion guard.
- `src/pages/Index.tsx`: restructure the hero so the gauge renders in a mobile slot (compact, above headline) and the desktop right column (as today); adjust mobile min-height/padding; align the glow.
- `src/pages/Rumors.tsx` (or the rumor card component): equal-height cards in a row.
- No backend, no routing, no dependency changes.

## Verification
- `npm run build` passes; `npm run test` and `tsgo` clean.
- Fixed-viewport Playwright screenshots at 390 / 768 / 1024 / 1440 confirming: mobile hero has no dead zone and shows the gauge; desktop hero unchanged; rumor cards equal height; gauge value still equals the rounded average of the four model scores with matching sentiment color.
