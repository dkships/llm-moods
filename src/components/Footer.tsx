const Footer = () => (
  <footer className="border-t border-border">
    <div className="container grid grid-cols-1 sm:grid-cols-3 items-center gap-4 py-8">
      <p className="text-sm text-muted-foreground font-mono text-center sm:text-left">
        Built for the AI-obsessed. LLM Vibes 2026.
      </p>
      <p className="text-sm text-muted-foreground font-mono text-center">
        Made with ❤️ by{" "}
        <a
          href="https://dmkthinks.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground hover:text-primary transition-colors"
        >
          David Kelly
        </a>
      </p>
      <div />
    </div>
  </footer>
);

export default Footer;
