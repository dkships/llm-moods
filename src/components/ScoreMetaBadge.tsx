import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ScoreMetaBadgeTone = "muted" | "primary" | "warning";

interface ScoreMetaBadgeProps {
  children: ReactNode;
  tone?: ScoreMetaBadgeTone;
  icon?: LucideIcon;
  title?: string;
  ariaLabel?: string;
  className?: string;
}

const toneClasses: Record<ScoreMetaBadgeTone, string> = {
  muted: "border-border bg-secondary/40 text-text-tertiary",
  primary: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-warning/30 bg-warning/10 text-warning",
};

const ScoreMetaBadge = ({
  children,
  tone = "muted",
  icon: Icon,
  title,
  ariaLabel,
  className,
}: ScoreMetaBadgeProps) => {
  return (
    <Badge
      variant="outline"
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium leading-5",
        toneClasses[tone],
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </Badge>
  );
};

export default ScoreMetaBadge;
