import { memo, useMemo } from "react";
import { ExternalLink } from "lucide-react";
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
    return "text-foreground bg-destructive/10 border-destructive/30";
  }
  if (severity === "minor") {
    return "text-foreground bg-warning/10 border-warning/30";
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
            className={`shrink-0 text-mono-cap ${severityClasses(event.severity)}`}
            aria-label={`Severity: ${severityLabel(event.severity)}`}
          >
            {severityLabel(event.severity)}
          </Badge>
          <span className="text-meta text-text-tertiary">{dateLabel}</span>
        </div>
        <p className="mt-1.5 text-body text-text-secondary">{event.title}</p>
        {topCorrelations.length > 0 && (
          <ul className="mt-2 space-y-1" aria-label="Correlated LLM Vibes anomalies">
            {topCorrelations.map((a) => (
              <li
                key={`${a.modelSlug}-${a.periodStart}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-mono-cap text-text-secondary mr-1.5"
              >
                <span>
                  Possible overlap · {formatAnomalyDate(a.periodStart)} {a.severity}
                </span>
                <span className="text-text-secondary">
                  z={a.z >= 0 ? "+" : ""}{a.z.toFixed(1)}
                </span>
              </li>
            ))}
            {remainingCount > 0 && (
              <span className="text-mono-cap text-text-tertiary">
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
            className="inline-flex items-center gap-1 text-meta text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
        <p className="text-body text-text-tertiary">
          Status data temporarily unavailable.
        </p>
      ) : !data?.supported ? (
        <p className="text-body text-text-tertiary">
          {data?.message ?? "No public status feed published by this vendor."}
        </p>
      ) : data.events.length === 0 ? (
        <>
          <p className="text-body text-text-secondary">
            All operational over the last 30 days
          </p>
          {data.fetchedAt && (
            <p className="mt-3 text-mono-cap text-text-tertiary">
              Last checked {formatTimeAgo(data.fetchedAt)}
            </p>
          )}
        </>
      ) : (
        <>
          <ul>
            {correlatedEvents.slice(0, 3).map((event) => (
              <StatusEventRow key={event.id} event={event} />
            ))}
          </ul>
          {correlatedEvents.every((event) => event.correlatedAnomalies.length === 0) && (
            <p className="mt-3 text-body text-text-tertiary">
              No matching score drop found.
            </p>
          )}
          {data.fetchedAt && (
            <p className="mt-3 text-mono-cap text-text-tertiary">
              Last checked {formatTimeAgo(data.fetchedAt)}
            </p>
          )}
        </>
      )}
    </Surface>
  );
};

export default memo(StatusCard);
