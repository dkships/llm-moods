import { Heart } from "lucide-react";

const Footer = () => (
  <footer className="border-t border-border">
    <div className="container flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-6 text-meta text-text-tertiary">
      <span>Built for the AI-obsessed. LLM Vibes 2026.</span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        Made with <Heart className="inline h-3 w-3 text-text-tertiary fill-current" /> by{" "}
        <a
          href="https://dmkthinks.org"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-0.5 rounded-md text-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          David Kelly
        </a>
      </span>
      <span aria-hidden="true">·</span>
      <a
        href="https://github.com/dkships/llm-moods"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center rounded-md py-1 font-mono text-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Open Source on GitHub
      </a>
    </div>
  </footer>
);

export default Footer;
