/**
 * Tailwind className for the research-article body wrapper.
 * Pulled out of ResearchPost.tsx so the JSX is readable and a future article
 * styling pass has a single place to edit.
 *
 * Each line groups one element type (paragraphs, links, code, etc.) so the
 * intent of each group is obvious.
 */
export const PROSE_CLASS_NAME = [
  "prose prose-invert max-w-none",
  // headings
  "prose-headings:font-display prose-headings:font-bold",
  "prose-h2:mt-10 prose-h2:text-2xl prose-h2:tracking-tight",
  "prose-h3:mt-6 prose-h3:text-xl",
  // paragraphs — bumped for reading rhythm
  "prose-p:text-text-secondary prose-p:text-[17px] prose-p:leading-[1.7]",
  // inline links
  "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
  "prose-strong:text-foreground",
  // inline code
  "prose-code:text-primary prose-code:before:content-none prose-code:after:content-none",
  "prose-code:bg-secondary/60 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em]",
  // pre/code blocks
  "prose-pre:bg-secondary/60 prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:p-4 prose-pre:font-mono prose-pre:text-sm",
  // blockquotes
  "prose-blockquote:border-l-primary prose-blockquote:bg-secondary/30 prose-blockquote:rounded-r-lg",
  "prose-blockquote:py-3 prose-blockquote:px-5 prose-blockquote:not-italic prose-blockquote:text-foreground/90",
  "[&_blockquote_p:first-of-type]:before:content-none [&_blockquote_p:last-of-type]:after:content-none",
  // tables (Phase 6A)
  "prose-table:font-mono prose-table:text-sm prose-table:border-collapse",
  "prose-th:bg-secondary/40 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-foreground",
  "prose-td:border-t prose-td:border-border prose-td:px-3 prose-td:py-2 prose-td:text-text-secondary",
].join(" ");
