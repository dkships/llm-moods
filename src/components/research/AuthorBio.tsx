/**
 * Author bio block rendered at the bottom of every research article.
 * Bio + contact constants live in src/data/author.ts (JSX-free so the
 * prerender plugin can import them); re-exported here for existing callers.
 */

import { AUTHOR_BIO, AUTHOR_NAME, AUTHOR_SAMEAS, BIO_LINKS } from "@/data/author";

export { AUTHOR_NAME, AUTHOR_SAMEAS };

const AuthorBio = () => (
  <aside className="mt-12 rounded-lg border border-border bg-secondary/30 px-6 py-5">
    <p className="text-mono-cap text-text-tertiary">
      About the author
    </p>
    <p className="mt-2 text-body text-foreground">
      <strong className="font-semibold">{AUTHOR_NAME}</strong>{" "}
      {AUTHOR_BIO}
    </p>
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-meta text-text-secondary">
      {BIO_LINKS.map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="inline-flex min-h-11 items-center rounded text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  </aside>
);


export default AuthorBio;
