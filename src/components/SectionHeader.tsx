import type { ReactNode } from "react";

type SectionHeaderLevel = "card" | "page";

interface SectionHeaderProps {
  title: string;
  meta?: string;
  action?: ReactNode;
  level?: SectionHeaderLevel;
  className?: string;
}

const SectionHeader = ({
  title,
  meta,
  action,
  level = "card",
  className = "",
}: SectionHeaderProps) => {
  const titleClass = level === "page" ? "text-page text-foreground" : "text-section text-foreground";
  return (
    <header className={`mb-4 ${className}`.trim()}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={titleClass}>{title}</h2>
        {action}
      </div>
      {meta && <p className="mt-1 text-meta text-text-tertiary">{meta}</p>}
    </header>
  );
};

export default SectionHeader;
