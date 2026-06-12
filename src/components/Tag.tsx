import type { ReactNode } from "react";

export type TagShape = "square" | "pill";
export type TagTone = "neutral" | "destructive" | "warning";

interface TagProps {
  children: ReactNode;
  shape?: TagShape; // default "square" (rounded-md)
  tone?: TagTone; // default "neutral"
  className?: string;
  title?: string;
}

const SHAPE: Record<TagShape, string> = {
  square: "rounded-md",
  pill: "rounded-full",
};

const TONE: Record<TagTone, string> = {
  neutral: "text-text-tertiary bg-secondary/40 border-border",
  destructive: "text-foreground bg-destructive/10 border-destructive/30",
  warning: "text-foreground bg-warning/10 border-warning/30",
};

const Tag = ({ children, shape = "square", tone = "neutral", className = "", title }: TagProps) => (
  <span
    title={title}
    className={[
      "inline-flex items-center gap-1.5 border px-2 py-0.5 text-mono-cap",
      SHAPE[shape],
      TONE[tone],
      className,
    ].join(" ")}
  >
    {children}
  </span>
);

export default Tag;
