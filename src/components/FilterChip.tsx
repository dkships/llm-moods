import type { ButtonHTMLAttributes, ReactNode } from "react";

type FilterChipVariant = "rect" | "pill";

interface FilterChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pressed: boolean;
  variant?: FilterChipVariant;
  children: ReactNode;
}

const SHAPE_CLASSES: Record<FilterChipVariant, string> = {
  rect: "rounded-md px-3 py-1.5",
  pill: "rounded-full px-3 py-1",
};

const FilterChip = ({
  pressed,
  variant = "rect",
  className = "",
  children,
  ...rest
}: FilterChipProps) => {
  const state = pressed
    ? "bg-primary/15 text-primary border-primary/30"
    : "border-border text-text-secondary hover:bg-secondary/50 hover:text-foreground";
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={[
        "shrink-0 border font-mono text-xs transition-colors",
        SHAPE_CLASSES[variant],
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
