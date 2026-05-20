import type { ButtonHTMLAttributes, ReactNode } from "react";

interface FilterChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pressed: boolean;
  children: ReactNode;
}

const FilterChip = ({ pressed, className = "", children, ...rest }: FilterChipProps) => {
  const state = pressed
    ? "bg-foreground/10 text-foreground border-foreground/20"
    : "bg-transparent text-text-tertiary border-border hover:text-foreground hover:border-foreground/30";
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={[
        "shrink-0 rounded-md border px-3 py-1.5 font-mono text-xs transition-colors",
        state,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
};

export default FilterChip;
