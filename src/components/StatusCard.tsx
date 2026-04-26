import { memo, useMemo } from "react";
import { ExternalLink, CheckCircle2, AlertCircle, ArrowLeftRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BarsSkeleton } from "@/components/Skeletons";
import Surface from "@/components/Surface";
import SectionHeader from "@/components/SectionHeader";
import { useVendorStatus, type StatusSeverity } from "@/hooks/useVendorStatus";
import { useScoreAnomalies } from "@/hooks/useScoreAnomalies";
import { VENDOR_BY_MODEL, type ModelSlug } from "@/data/vendor-events";
import { formatTimeAgo } from "@/lib/vibes";
import { correlateStatusWithAnomalies, type CorrelatedStatusEvent } from "@/lib/status-correlation";

interface StatusCardProps {
  modelSlug: string;
}

const VENDOR_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Cloud",
  xai: "xAI",
};

function severityClasses(severity: StatusSeverity): string {
  if (severity === "critical" || severity === "major") {
    return "text-destructive bg-destructive/10 border-destructive/20";
  }
  if (severity === "minor") {
    return "text-warning bg-warning/10 border-warning/20";
  }
  if (severity === "maintenance") {
    return "text-text-tertiary bg-secondary/40 border-border";
  }
  return "text-text-tertiary bg-secondary/40 border-border";
}

function severityLabel(severity: StatusSeverity): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "major":
      return "Major";
    case "minor":
      return "Minor";
    case "maintenance":
      return "Maintenance";
    default:
      return "Update";
  }
}

function formatAnomalyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const StatusEventRow = memo(({ event }: { event: CorrelatedStatusEvent }) => {
  const dateLabel = formatAnomalyDate(event.updatedAt);
  const topCorrelations = event.correlatedAnomalies.slice(0, 2);
  const remainingCount = event.correlatedAnomalies.length - topCorrelations.length;

  return (
    <li className="flex items-start justify-between gap-3 py-3 border-b border-border/40 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={`shrink-0 text-[10px] font-mono uppercase tracking-wide ${severityClasses(event.severity)}`}
            aria-label={`Severity: ${severityLabel(event.severity)}`}
          >
            {severityLabel(event.severity)}
          </Badge>
          <span className="font-mono text-xs text-text-tertiary">{dateLabel}</span>
        </div>
        <p className="mt-1.5 text-sm text-text-secondary leading-snug">{event.title}</p>
        {topCorrelations.length > 0 && (
          <ul className="mt-2 space-y-1" aria-label="Correlated LLM Vibes anomalies">
            {topCorrelations.map((a) => (
              <li
                key={`${a.modelSlug}-${a.periodStart}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-2 py-0.5 font-mono text-[10px] text-text-secondary mr-1.5"
              >
                <ArrowLeftRight className="h-3 w-3 text-primary" aria-hidden="true" />
                <span>
                  Our {formatAnomalyDate(a.periodStart)} {a.severity}
                </span>
                <span className={a.z < 0 ? "text-destructive" : "text-primary"}>
                  z={a.z >= 0 ? "+" : ""}{a.z.toFixed(1)}
                </span>
              </li>
            ))}
            {remainingCount > 0 && (
              <span className="font-mono text-[10px] text-text-tertiary">
                +{remainingCount} more
              </span>
            )}
          </ul>
        )}
      </div>
      {event.url && (
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Read ${event.title} on the official status page`}
          className="shrink-0 self-start mt-0.5 text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </li>
  );
});
StatusEventRow.displayName = "StatusEventRow";

const StatusCard = ({ modelSlug }: StatusCardProps) => {
  const slug = modelSlug as ModelSlug;
  const vendor = VENDOR_BY_MODEL[slug];
  const { data, isLoading, isError } = useVendorStatus(vendor);
  const { data: anomalies } = useScoreAnomalies();

  const vendorName = VENDOR_LABEL[vendor] ?? vendor;

  const correlatedEvents = useMemo(() => {
    if (!data?.events?.length) return [];
    return correlateStatusWithAnomalies(data.events, anomalies ?? [], modelSlug);
  }, [data?.events, anomalies, modelSlug]);

  return (
    <Surface as="section" motion="fade" aria-label={`Official status for ${vendorName}`}>
      <SectionHeader
        title="Official Status"
        meta={vendorName}
        action={data?.publicUrl && (
          <a
            href={data.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={`Open ${vendorName} status page`}
          >
            status page
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      />

      {isLoading ? (
        <BarsSkeleton count={3} />
      ) : isError ? (
        <div className="flex items-center gap-2 text-sm text-text-tertiary">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Status data temporarily unavailable.</span>
        </div>
      ) : !data?.supported ? (
        <p className="text-sm text-text-tertiary">
          {data?.message ?? "No public status feed published by this vendor."}
        </p>
      ) : data.events.length === 0 ? (
        <>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>All operational over the last 30 days</span>
          </div>
          {data.fetchedAt && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
              Last checked {formatTimeAgo(data.fetchedAt)}
            </p>
          )}
        </>
      ) : (
        <>
          <ul>
            {correlatedEvents.slice(0, 5).map((event) => (
              <StatusEventRow key={event.id} event={event} />
            ))}
          </ul>
          {data.fetchedAt && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
              Last checked {formatTimeAgo(data.fetchedAt)}
            </p>
          )}
        </>
      )}
    </Surface>
  );
};

export default memo(StatusCard);
