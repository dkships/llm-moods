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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <h1 className="text-page text-foreground">{title}</h1>
      {freshness}
    </div>
    {meta && (
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <p className="text-meta text-text-tertiary">{meta}</p>
      </div>
    )}
    {description && (
      <p className="mt-3 max-w-2xl text-body text-text-secondary">{description}</p>
    )}
  </div>
);

export default PageHeader;
