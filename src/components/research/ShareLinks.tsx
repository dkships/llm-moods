import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { CONTROL_PILL_CLASS } from "@/components/ControlPill";

interface ShareLinksProps {
  /** Absolute canonical URL of the article. */
  url: string;
  /** Article title, used as the prefilled X post text. */
  title: string;
}

const CONTROL_CLASS = CONTROL_PILL_CLASS;

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
    <div className="flex flex-wrap items-center gap-3">
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
