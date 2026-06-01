import { useState } from "react";
import { Check, Link2 } from "lucide-react";

interface ShareLinksProps {
  /** Absolute canonical URL of the article. */
  url: string;
  /** Article title, used as the prefilled X post text. */
  title: string;
}

// Mirrors the dataset-download control in ResearchPost — neutral surface, mono text,
// no accent tint (accent is reserved for chart/brand chrome).
const CONTROL_CLASS =
  "inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-1.5 font-mono text-xs text-text-secondary transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const ShareLinks = ({ url, title }: ShareLinksProps) => {
  const [copied, setCopied] = useState(false);

  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
  const linkedInHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-border pt-6">
      <span className="text-mono-cap text-text-tertiary">Share</span>
      <a className={CONTROL_CLASS} href={xHref} target="_blank" rel="noopener noreferrer">
        Post on X
      </a>
      <a className={CONTROL_CLASS} href={linkedInHref} target="_blank" rel="noopener noreferrer">
        LinkedIn
      </a>
      <button type="button" className={CONTROL_CLASS} onClick={copyLink} aria-live="polite">
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
};

export default ShareLinks;
