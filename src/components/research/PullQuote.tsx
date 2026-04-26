/**
 * Verbatim user-post quote with platform / handle / timestamp meta.
 * Replaces a plain <blockquote> for high-impact citations where the
 * exact text and timing are the load-bearing content.
 */

interface PullQuoteProps {
  /** The verbatim quoted text (no quotation marks — component adds them). */
  text: string;
  /** Display handle, e.g. "@tetrac-official". */
  handle: string;
  /** Platform name, e.g. "Bluesky". */
  platform: string;
  /** Timestamp string, e.g. "2026-03-26 10:42 UTC". */
  timestamp: string;
  /** Link to the original post. */
  href: string;
  /** Optional Wayback / archive URL for defensive citation. */
  archivedHref?: string;
}

const PullQuote = ({ text, handle, platform, timestamp, href, archivedHref }: PullQuoteProps) => (
  <figure className="my-6 border-l-2 border-primary bg-secondary/40 pl-5 pr-4 py-4 rounded-r-lg">
    <blockquote className="not-italic text-[1.0625rem] leading-[1.65] text-foreground">
      <span aria-hidden="true" className="select-none text-primary/60 mr-1">
        “
      </span>
      {text}
      <span aria-hidden="true" className="select-none text-primary/60 ml-0.5">
        ”
      </span>
    </blockquote>
    <figcaption className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {handle}
      </a>
      <span aria-hidden="true">·</span>
      <span>{platform}</span>
      <span aria-hidden="true">·</span>
      <span>{timestamp}</span>
      {archivedHref ? (
        <>
          <span aria-hidden="true">·</span>
          <a
            href={archivedHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-secondary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            archived
          </a>
        </>
      ) : null}
    </figcaption>
  </figure>
);

export default PullQuote;
