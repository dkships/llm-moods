import { Link } from "react-router-dom";

const NavBar = () => {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center">
        <Link to="/" aria-label="Home" className="font-display text-lg font-bold tracking-tight text-foreground">
          🌊 LLM <span className="text-primary">Vibes</span>
        </Link>
      </div>
    </header>
  );
};

export default NavBar;
