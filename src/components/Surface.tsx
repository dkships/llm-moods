import type { ElementType, ReactNode, ComponentPropsWithoutRef } from "react";

const sizeClasses = {
  default: "rounded-xl p-6", // standard card
  compact: "rounded-lg p-4", // chatter rows, dense rows
  bare: "rounded-xl", // wrappers that own their own padding
} as const;

export type SurfaceSize = keyof typeof sizeClasses;

type SurfaceOwnProps<T extends ElementType> = {
  as?: T;
  size?: SurfaceSize;
  motion?: "fade" | false;
  elevation?: "none" | "card" | "lift";
  className?: string;
  children?: ReactNode;
};

type SurfaceProps<T extends ElementType> = SurfaceOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof SurfaceOwnProps<T>>;

const HOVER = "transition-colors duration-200 hover:border-border/80";

function Surface<T extends ElementType = "div">({
  as,
  size = "default",
  motion = false,
  elevation = "card",
  className,
  children,
  ...rest
}: SurfaceProps<T>) {
  const Component = (as ?? "div") as ElementType;
  const classes = [
    "glass",
    sizeClasses[size],
    HOVER,
    elevation === "card" && "surface-card",
    elevation === "lift" && "surface-card surface-lift",
    motion === "fade" && "animate-fade-in",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}

export default Surface;
