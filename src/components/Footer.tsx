import { Link } from "react-router-dom";
import {
  AUTHOR_LINKEDIN_URL,
  AUTHOR_NAME,
  AUTHOR_PORTFOLIO_URL,
} from "@/data/author";

const LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:min-h-0";

const Footer = () => (
  <footer className="border-t border-border bg-card/35">
    <div className="container flex flex-col gap-3 pb-24 pt-6 text-meta text-text-tertiary sm:pb-14 md:flex-row md:items-center md:justify-between md:gap-6">
      <p className="text-text-secondary">
        LLM Vibes · Built by{" "}
        <a
          href={AUTHOR_PORTFOLIO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {AUTHOR_NAME}
        </a>
      </p>
      <nav aria-label="Footer links">
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          <li>
            <a
              href="https://github.com/dkships/llm-moods"
              target="_blank"
              rel="noopener noreferrer"
              className={`${LINK_CLASS} text-foreground`}
            >
              GitHub
            </a>
          </li>
          <li>
            <Link to="/privacy" className={LINK_CLASS}>
              Privacy
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  </footer>
);

export default Footer;
