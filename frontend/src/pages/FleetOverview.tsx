import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, DeviceEvaluation, EvaluationResponse, ApiError } from "@/lib/api";
import { SeverityBadge } from "@/components/SeverityBadge";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, AlertTriangle, ShieldCheck, Server, Activity, ArrowRight } from "lucide-react";

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
      .evaluateInventory()
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
    <div className="relative min-h-[80vh] p-6 space-y-8 max-w-[1600px] mx-auto animate-in fade-in duration-700">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute left-[10%] top-[0%] h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <div className="pointer-events-none absolute right-[0%] top-[20%] h-[400px] w-[500px] translate-x-1/3 -translate-y-1/3 rounded-full bg-secondary/10 blur-[120px]" />

      <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-mono tracking-[0.2em] text-primary uppercase mb-4 shadow-sm">
             <Activity className="h-3 w-3" /> // Global Dashboard
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-foreground/50 bg-clip-text text-transparent">Fleet Overview</h1>
          <p className="text-base text-muted-foreground mt-2 max-w-2xl leading-relaxed">
            Live compliance posture and risk exposure across evaluated Dell enterprise devices.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-all glow-primary shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Re-evaluate Fleet
        </button>
      </div>

      {/* Summary cards */}
      <div className="relative z-10 grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
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
      <div className="relative z-10 flex items-center gap-2 flex-wrap bg-card/40 backdrop-blur-md p-2 rounded-xl border border-border/50 shadow-sm w-fit">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mr-3 ml-2 font-semibold">
          Severity Filter:
        </span>
        {["ALL", "BLOCKER", "CRITICAL", "WARNING", "INFO"].map((s) => (
          <button
            key={s}
            onClick={() => setSeverityFilter(s)}
            className={cn(
              "px-4 py-1.5 text-[11px] font-bold font-mono uppercase tracking-wider rounded-lg transition-all duration-300",
              severityFilter === s
                ? "bg-primary text-primary-foreground shadow-md scale-105"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-2/60",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="relative z-10 glass-panel rounded-2xl overflow-hidden border border-border/50 shadow-xl bg-card/30 backdrop-blur-2xl">
        <div className="grid grid-cols-12 px-6 py-4 border-b border-border/50 bg-surface-2/40 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div className="col-span-4">Device Target</div>
          <div className="col-span-2">Health Score</div>
          <div className="col-span-4">Active Violations</div>
          <div className="col-span-2 text-right">Last Scan</div>
        </div>

        {error && (
          <div className="p-12 text-center space-y-4">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-destructive/10 text-destructive mb-2">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <div className="text-sm font-medium text-destructive">{error}</div>
            <button
              onClick={load}
              className="px-4 py-2 bg-background rounded border shadow-sm text-[12px] font-mono uppercase tracking-wider text-primary hover:bg-primary/5 transition-colors"
            >
              Retry Connection
            </button>
          </div>
        )}

        {!error && loading && (
          <div className="divide-y divide-border/50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-6 py-4">
                <Skeleton className="h-6 w-full rounded bg-muted/50" />
              </div>
            ))}
          </div>
        )}

        {!error && !loading && filtered.length === 0 && (
          <div className="p-16 text-center space-y-4 flex flex-col items-center">
            <div className="relative">
              <div className="absolute inset-0 bg-success/20 blur-xl rounded-full" />
              <ShieldCheck className="relative h-16 w-16 text-success mx-auto" />
            </div>
            <div className="text-xl font-semibold text-foreground tracking-tight">
              Fleet is Fully Compliant
            </div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              No violations match the current filter. Upload more inventory or rules in <Link to="/rules" className="text-primary hover:underline font-medium">Rule Management</Link> to run further evaluations.
            </p>
          </div>
        )}

        {!error && !loading && filtered.length > 0 && (
          <div className="divide-y divide-border/50">
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
                  className="group grid grid-cols-12 items-center px-6 py-4 hover:bg-primary/5 transition-all duration-300 relative"
                >
                  <div className="col-span-4 flex items-center gap-4 min-w-0">
                    <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-surface-2/80 border border-border/50 group-hover:border-primary/30 group-hover:bg-primary/10 transition-colors shadow-sm shrink-0">
                      <Server className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-foreground group-hover:text-primary transition-colors truncate">{d.name ?? d.device_id}</div>
                      <div className="font-mono text-[11px] text-muted-foreground truncate mt-0.5">
                        {d.device_id}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 flex items-baseline gap-1">
                    <span className={cn("font-mono text-[22px] font-bold tabular-nums tracking-tight", scoreColor(d.compliance_score))}>
                      {d.compliance_score ?? "—"}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground/60 font-medium">/100</span>
                  </div>
                  <div className="col-span-4 flex flex-wrap gap-2 pr-4">
                    {Object.keys(counts).length === 0 ? (
                      <span className="inline-flex items-center px-2 py-1 rounded bg-success/10 border border-success/20 text-[11px] text-success font-mono font-bold tracking-wider">CLEAN</span>
                    ) : (
                      Object.entries(counts).map(([sev, n]) => (
                        <span key={sev} className="inline-flex items-center gap-1.5 bg-background/50 border border-border/50 px-2 py-1 rounded shadow-sm">
                          <SeverityBadge severity={sev} />
                          <span className="font-mono text-[11px] font-bold text-foreground opacity-80">×{n}</span>
                        </span>
                      ))
                    )}
                  </div>
                  <div className="col-span-2 text-right font-mono text-[11px] text-muted-foreground flex items-center justify-end gap-3 opacity-60 group-hover:opacity-100 transition-opacity">
                    {d.last_evaluated ?? "—"}
                    <ArrowRight className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-300" />
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
  const toneMap = {
    primary: {
      bg: "from-primary/10 to-transparent border-primary/20 hover:border-primary/40",
      text: "text-primary",
      iconBg: "bg-primary/10",
      glow: "group-hover:shadow-[0_0_20px_rgba(var(--primary),0.15)]",
    },
    success: {
      bg: "from-success/10 to-transparent border-success/20 hover:border-success/40",
      text: "text-success",
      iconBg: "bg-success/10",
      glow: "group-hover:shadow-[0_0_20px_rgba(var(--success),0.15)]",
    },
    critical: {
      bg: "from-destructive/10 to-transparent border-destructive/20 hover:border-destructive/40",
      text: "text-destructive",
      iconBg: "bg-destructive/10",
      glow: "group-hover:shadow-[0_0_20px_rgba(var(--destructive),0.15)]",
    },
    warning: {
      bg: "from-warning/10 to-transparent border-warning/20 hover:border-warning/40",
      text: "text-warning",
      iconBg: "bg-warning/10",
      glow: "group-hover:shadow-[0_0_20px_rgba(var(--warning),0.15)]",
    },
  };
  
  const config = toneMap[tone];

  return (
    <div className={cn("relative overflow-hidden glass-panel rounded-2xl p-6 border-t bg-gradient-to-b transition-all duration-300 group", config.bg, config.glow)}>
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {label}
        </div>
        <div className={cn("flex items-center justify-center h-8 w-8 rounded-full", config.iconBg)}>
          <Icon className={cn("h-4 w-4", config.text)} />
        </div>
      </div>
      <div className="relative z-10">
        {loading ? (
          <Skeleton className="h-10 w-20 rounded-md bg-foreground/5" />
        ) : (
          <div className={cn("font-mono text-4xl font-extrabold tabular-nums tracking-tighter", config.text)}>
            {value}
          </div>
        )}
      </div>
      {/* Decorative gradient blur in corner */}
      <div className={cn("absolute -bottom-6 -right-6 h-24 w-24 rounded-full blur-2xl opacity-20 transition-opacity duration-500 group-hover:opacity-40", config.iconBg)} />
    </div>
  );
}