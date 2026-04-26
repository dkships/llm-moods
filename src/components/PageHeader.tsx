import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  meta?: string;
  freshness?: ReactNode;
  className?: string;
}

const PageHeader = ({
  title,
  description,
  meta,
  freshness,
  className = "",
}: PageHeaderProps) => (
  <div className={className}>
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <h1 className="text-3xl sm:text-4xl font-bold text-foreground">{title}</h1>
      {freshness}
    </div>
    {meta && (
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <p className="font-mono text-sm text-text-tertiary">{meta}</p>
      </div>
    )}
    {description && (
      <p className="mt-2 text-sm text-text-secondary">{description}</p>
    )}
  </div>
);

export default PageHeader;
