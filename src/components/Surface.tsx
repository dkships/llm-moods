import type { ElementType, ReactNode, ComponentPropsWithoutRef } from "react";

const sizeClasses = {
  default: "rounded-xl p-6",
  compact: "rounded-lg p-4",
  tight: "rounded-lg p-5",
  bare: "rounded-xl",
} as const;

const toneClasses = {
  default: "",
  accent: "border-l-2 border-l-primary",
} as const;

export type SurfaceSize = keyof typeof sizeClasses;
export type SurfaceTone = keyof typeof toneClasses;

type SurfaceOwnProps<T extends ElementType> = {
  as?: T;
  size?: SurfaceSize;
  tone?: SurfaceTone;
  motion?: "fade" | false;
  className?: string;
  children?: ReactNode;
};

type SurfaceProps<T extends ElementType> = SurfaceOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof SurfaceOwnProps<T>>;

const HOVER = "transition-colors duration-200 hover:border-border/80";

function Surface<T extends ElementType = "div">({
  as,
  size = "default",
  tone = "default",
  motion = false,
  className,
  children,
  ...rest
}: SurfaceProps<T>) {
  const Component = (as ?? "div") as ElementType;
  const classes = [
    "glass",
    sizeClasses[size],
    toneClasses[tone],
    HOVER,
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
