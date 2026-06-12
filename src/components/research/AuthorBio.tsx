/**
 * Author bio block rendered at the bottom of every research article.
 * Single source of truth for David's bio + contact links so updates
 * stay in one place. Edit BIO_LINKS to add or change contact channels.
 */

const BIO_LINKS: ReadonlyArray<{ label: string; href: string; external: boolean }> = [
  { label: "dmkthinks.org", href: "https://dmkthinks.org", external: true },
  { label: "linkedin.com/in/thedmkelly", href: "https://www.linkedin.com/in/thedmkelly/", external: true },
  { label: "github.com/dkships", href: "https://github.com/dkships", external: true },
];

/**
 * Author identity used by Article JSON-LD (`author.sameAs`). Single
 * source of truth shared with the visible bio links above so the
 * structured-data entity and the on-page links never drift.
 */
export const AUTHOR_NAME = "David Kelly";
export const AUTHOR_SAMEAS: readonly string[] = BIO_LINKS.map((l) => l.href);

const AuthorBio = () => (
  <aside className="mt-12 rounded-lg border border-border bg-secondary/30 px-6 py-5">
    <p className="text-mono-cap text-text-tertiary">
      About the author
    </p>
    <p className="mt-2 text-body text-foreground">
      <strong className="font-semibold">David Kelly</strong> is a product and growth contractor focused on
      consumer AI tools, currently exploring product roles in AI safety and frontier-model reliability. He
      builds llmvibes.ai independently, and advises on product, growth, and AI tooling for AppSumo Originals.
    </p>
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-meta text-text-secondary">
      {BIO_LINKS.map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  </aside>
);

export default AuthorBio;
