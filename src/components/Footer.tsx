import { Link } from "react-router-dom";
import { AUTHOR_NAME, AUTHOR_PORTFOLIO_URL } from "@/data/author";

const LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const Footer = () => (
  <footer className="border-t border-border bg-card/35">
    <div className="container flex flex-col gap-6 py-10 text-meta text-text-tertiary sm:py-12 md:flex-row md:items-start md:justify-between md:gap-8">
      <div>
        <Link to="/" className={`${LINK_CLASS} text-section text-foreground`}>LLM Vibes</Link>
        <p className="mt-1 text-body text-text-secondary">A daily read on AI sentiment.</p>
        <p className="mt-3">
          Built by{" "}
          <a
            href={AUTHOR_PORTFOLIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md text-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {AUTHOR_NAME}
          </a>
        </p>
      </div>
      <nav aria-label="Footer links">
        <ul className="flex flex-wrap gap-x-6 gap-y-1">
          <li>
            <Link to="/dashboard" className={`${LINK_CLASS} text-text-secondary`}>Dashboard</Link>
          </li>
          <li>
            <Link to="/research/how-llm-vibes-classifies-sentiment" className={`${LINK_CLASS} text-text-secondary`}>Methodology</Link>
          </li>
          <li>
            <a
              href="https://github.com/dkships/llm-moods"
              target="_blank"
              rel="noopener noreferrer"
              className={`${LINK_CLASS} text-text-secondary`}
            >
              GitHub
            </a>
          </li>
          <li>
            <Link to="/privacy" className={`${LINK_CLASS} text-text-secondary`}>
              Privacy
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  </footer>
);

export default Footer;
