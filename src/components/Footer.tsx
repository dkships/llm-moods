const Footer = () => (
  <footer className="border-t border-border">
    <div className="container flex flex-col sm:flex-row items-center justify-between gap-4 py-8">
      <p className="text-sm text-muted-foreground font-mono">
        Built for the AI-obsessed. LLM Vibes 2026.
      </p>
      <p className="text-sm text-muted-foreground font-mono">
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
    </div>
  </footer>
);

export default Footer;
