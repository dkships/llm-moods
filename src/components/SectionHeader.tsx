import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type SectionHeaderLevel = "card" | "page";

interface SectionHeaderProps {
  title: string;
  meta?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  level?: SectionHeaderLevel;
  className?: string;
}

const SectionHeader = ({
  title,
  meta,
  icon: Icon,
  action,
  level = "card",
  className = "",
}: SectionHeaderProps) => {
  const titleClass =
    level === "page"
      ? "text-xl font-bold text-foreground"
      : "text-lg font-semibold text-foreground";
  return (
    <header className={`mb-4 ${className}`.trim()}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-primary" aria-hidden="true" />}
          <h2 className={titleClass}>{title}</h2>
        </div>
        {action}
      </div>
      {meta && <p className="mt-1 font-mono text-xs text-text-tertiary">{meta}</p>}
    </header>
  );
};

export default SectionHeader;
