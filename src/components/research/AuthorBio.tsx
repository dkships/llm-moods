/**
 * Author bio block rendered at the bottom of every research article.
 * Single source of truth for David's bio + contact links so updates
 * stay in one place. Edit BIO_LINKS to add or change contact channels.
 */

const BIO_LINKS: ReadonlyArray<{ label: string; href: string; external: boolean }> = [
  { label: "dmkthinks.org", href: "https://dmkthinks.org", external: true },
  { label: "linkedin.com/in/thedmkelly", href: "https://www.linkedin.com/in/thedmkelly/", external: true },
  { label: "github.com/dkships", href: "https://github.com/dkships", external: true },
  { label: "reg@dmkthinks.org", href: "mailto:reg@dmkthinks.org", external: false },
];

const AuthorBio = () => (
  <aside className="mt-12 rounded-lg border border-border bg-secondary/30 px-6 py-5">
    <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
      About the author
    </p>
    <p className="mt-2 text-base text-foreground">
      <strong className="font-semibold">David Kelly</strong> is a product and growth contractor focused on
      consumer AI tools. He builds llmvibes.ai independently, and advises on product, growth, and AI tooling for
      AppSumo Originals, FOUND, and Table22.
    </p>
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-text-secondary">
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
