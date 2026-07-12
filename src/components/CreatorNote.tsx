import {
  AUTHOR_CREATOR_NOTE,
  AUTHOR_LINKEDIN_URL,
  AUTHOR_PORTFOLIO_URL,
} from "@/data/author";

const CreatorNote = () => (
  <aside
    className="mt-10 border-t border-border pt-8 sm:mt-12 sm:pt-10"
    aria-labelledby="creator-note-title"
  >
    <p id="creator-note-title" className="text-mono-cap text-text-tertiary">
      Built independently
    </p>
    <p className="mt-3 max-w-2xl text-body text-text-secondary">
      {AUTHOR_CREATOR_NOTE}
    </p>
    <div className="mt-3 flex flex-wrap gap-x-4 text-meta">
      <a
        href={AUTHOR_PORTFOLIO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center rounded-md text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Portfolio
      </a>
      <a
        href={AUTHOR_LINKEDIN_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center rounded-md text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        LinkedIn
      </a>
    </div>
  </aside>
);

export default CreatorNote;
