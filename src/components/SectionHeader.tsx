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
    <header className={`mb-5 ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className={titleClass}>{title}</h2>
        {action}
      </div>
      {meta && <p className="mt-2 text-meta text-text-tertiary">{meta}</p>}
    </header>
  );
};

export default SectionHeader;
