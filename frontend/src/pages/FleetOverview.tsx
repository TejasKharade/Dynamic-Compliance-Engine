import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, DeviceEvaluation, EvaluationResponse, ApiError } from "@/lib/api";
import { SeverityBadge } from "@/components/SeverityBadge";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, AlertTriangle, ShieldCheck, Server, Activity } from "lucide-react";

function scoreColor(score?: number) {
  if (score == null) return "text-muted-foreground";
  if (score >= 90) return "text-success";
  if (score >= 70) return "text-warning";
  return "text-destructive";
}

function summarize(devices: DeviceEvaluation[]) {
  const total = devices.length;
  const compliant = devices.filter((d) => (d.compliance_score ?? 0) >= 90).length;
  const critical = devices.reduce(
    (n, d) =>
      n +
      (d.violations ?? []).filter((v) =>
        ["BLOCKER", "CRITICAL"].includes((v.severity ?? "").toUpperCase()),
      ).length,
    0,
  );
  const attention = devices.filter((d) => (d.compliance_score ?? 100) < 90).length;
  return { total, compliant, critical, attention };
}

export default function FleetOverview() {
  const [data, setData] = useState<EvaluationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .evaluateInventory({})
      .then((res) => setData(res))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const devices = data?.devices ?? [];
  const summary = useMemo(() => summarize(devices), [devices]);

  const filtered = useMemo(() => {
    if (severityFilter === "ALL") return devices;
    return devices.filter((d) =>
      (d.violations ?? []).some(
        (v) => (v.severity ?? "").toUpperCase() === severityFilter,
      ),
    );
  }, [devices, severityFilter]);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase mb-1">
            // Dashboard
          </div>
          <h1 className="text-2xl font-semibold">Fleet Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live compliance posture across evaluated Dell enterprise devices.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors glow-primary"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Re-evaluate Fleet
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          icon={Server}
          label="Total Devices"
          value={summary.total}
          tone="primary"
          loading={loading}
        />
        <SummaryCard
          icon={ShieldCheck}
          label="% Compliant"
          value={
            summary.total
              ? `${Math.round((summary.compliant / summary.total) * 100)}%`
              : "—"
          }
          tone="success"
          loading={loading}
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Critical Violations"
          value={summary.critical}
          tone="critical"
          loading={loading}
        />
        <SummaryCard
          icon={Activity}
          label="Needs Attention"
          value={summary.attention}
          tone="warning"
          loading={loading}
        />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mr-2">
          Filter:
        </span>
        {["ALL", "BLOCKER", "CRITICAL", "WARNING", "INFO"].map((s) => (
          <button
            key={s}
            onClick={() => setSeverityFilter(s)}
            className={cn(
              "px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded border transition-colors",
              severityFilter === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-2.5 border-b border-border bg-surface-2/40 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-4">Device</div>
          <div className="col-span-2">Score</div>
          <div className="col-span-3">Violations</div>
          <div className="col-span-3 text-right">Last Evaluated</div>
        </div>

        {error && (
          <div className="p-8 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
            <div className="text-sm text-destructive">{error}</div>
            <button
              onClick={load}
              className="text-[12px] font-mono uppercase tracking-wider text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {!error && loading && (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        )}

        {!error && !loading && filtered.length === 0 && (
          <div className="p-12 text-center space-y-2">
            <ShieldCheck className="h-10 w-10 text-success mx-auto" />
            <div className="text-success font-medium">
              No violations found — fleet is fully compliant.
            </div>
            <p className="text-sm text-muted-foreground">
              Upload inventory or rules in <Link to="/rules" className="text-primary hover:underline">Rule Ingestion</Link> to evaluate more devices.
            </p>
          </div>
        )}

        {!error && !loading && filtered.length > 0 && (
          <div className="divide-y divide-border">
            {filtered.map((d) => {
              const counts = (d.violations ?? []).reduce(
                (acc, v) => {
                  const k = (v.severity ?? "INFO").toUpperCase();
                  acc[k] = (acc[k] ?? 0) + 1;
                  return acc;
                },
                {} as Record<string, number>,
              );
              return (
                <Link
                  key={d.device_id}
                  to={`/devices/${encodeURIComponent(d.device_id)}`}
                  className="grid grid-cols-12 items-center px-4 py-3 hover:bg-surface-2/60 transition-colors"
                >
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
                    <Server className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium truncate">{d.name ?? d.device_id}</div>
                      <div className="font-mono text-[10px] text-muted-foreground truncate">
                        {d.device_id}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <span className={cn("font-mono text-[18px] font-semibold tabular-nums", scoreColor(d.compliance_score))}>
                      {d.compliance_score ?? "—"}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground ml-1">/100</span>
                  </div>
                  <div className="col-span-3 flex flex-wrap gap-1.5">
                    {Object.keys(counts).length === 0 ? (
                      <span className="text-[11px] text-success font-mono">CLEAN</span>
                    ) : (
                      Object.entries(counts).map(([sev, n]) => (
                        <span key={sev} className="inline-flex items-center gap-1">
                          <SeverityBadge severity={sev} />
                          <span className="font-mono text-[11px] text-muted-foreground">×{n}</span>
                        </span>
                      ))
                    )}
                  </div>
                  <div className="col-span-3 text-right font-mono text-[11px] text-muted-foreground">
                    {d.last_evaluated ?? "—"}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
  loading,
}: {
  icon: typeof Server;
  label: string;
  value: string | number;
  tone: "primary" | "success" | "critical" | "warning";
  loading?: boolean;
}) {
  const toneColors: Record<string, string> = {
    primary: "text-primary border-primary/30",
    success: "text-success border-success/30",
    critical: "text-destructive border-destructive/30",
    warning: "text-warning border-warning/30",
  };
  return (
    <div className={cn("glass-panel rounded-lg p-4 border-l-2", toneColors[tone])}>
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <Icon className={cn("h-4 w-4 opacity-70", toneColors[tone])} />
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <div className={cn("font-mono text-2xl font-semibold tabular-nums", toneColors[tone])}>
          {value}
        </div>
      )}
    </div>
  );
}