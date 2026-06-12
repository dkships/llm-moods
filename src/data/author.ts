/**
 * Author identity for research articles. JSX-free on purpose: the build-time
 * prerender plugin (scripts/prerender-routes.ts) imports these constants to
 * emit Article JSON-LD, so they must not live in a component file.
 *
 * Single source of truth for David's bio + contact links; the visible bio
 * (src/components/research/AuthorBio.tsx) and the structured-data entity
 * both read from here so they never drift.
 */

export const BIO_LINKS: ReadonlyArray<{ label: string; href: string; external: boolean }> = [
  { label: "dmkthinks.org", href: "https://dmkthinks.org", external: true },
  { label: "linkedin.com/in/thedmkelly", href: "https://www.linkedin.com/in/thedmkelly/", external: true },
  { label: "github.com/dkships", href: "https://github.com/dkships", external: true },
];

export const AUTHOR_NAME = "David Kelly";
export const AUTHOR_SAMEAS: readonly string[] = BIO_LINKS.map((l) => l.href);
