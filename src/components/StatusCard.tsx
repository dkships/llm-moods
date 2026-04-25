import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { ExternalLink, CheckCircle2, AlertCircle, ArrowLeftRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BarsSkeleton } from "@/components/Skeletons";
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
    return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
  }
  if (severity === "maintenance") {
    return "text-muted-foreground bg-secondary/40 border-border";
  }
  return "text-muted-foreground bg-secondary/40 border-border";
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
          <span className="font-mono text-xs text-muted-foreground">{dateLabel}</span>
        </div>
        <p className="mt-1.5 text-sm text-foreground/90 leading-snug">{event.title}</p>
        {topCorrelations.length > 0 && (
          <ul className="mt-2 space-y-1" aria-label="Correlated LLM Vibes anomalies">
            {topCorrelations.map((a) => (
              <li
                key={`${a.modelSlug}-${a.periodStart}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-2 py-0.5 font-mono text-[10px] text-foreground/80 mr-1.5"
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
              <span className="font-mono text-[10px] text-muted-foreground">
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
          className="shrink-0 self-start mt-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.45 }}
      className="glass rounded-xl p-6"
      aria-label={`Official status for ${vendorName}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">Official Status</h2>
          <span className="font-mono text-xs text-muted-foreground">{vendorName}</span>
        </div>
        {data?.publicUrl && (
          <a
            href={data.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={`Open ${vendorName} status page`}
          >
            status page
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {isLoading ? (
        <div className="mt-4">
          <BarsSkeleton count={3} />
        </div>
      ) : isError ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Status data temporarily unavailable.</span>
        </div>
      ) : !data?.supported ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {data?.message ?? "No public status feed published by this vendor."}
        </p>
      ) : data.events.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-foreground/85">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            All operational over the last 30 days
            {data.fetchedAt && (
              <span className="ml-2 text-xs text-muted-foreground font-mono">
                checked {formatTimeAgo(data.fetchedAt)}
              </span>
            )}
          </span>
        </div>
      ) : (
        <>
          <ul className="mt-4">
            {correlatedEvents.slice(0, 5).map((event) => (
              <StatusEventRow key={event.id} event={event} />
            ))}
          </ul>
          {data.fetchedAt && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Last checked {formatTimeAgo(data.fetchedAt)}
            </p>
          )}
        </>
      )}
    </motion.section>
  );
};

export default memo(StatusCard);
