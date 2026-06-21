import { useEffect, useState } from "react";
import { api, ApiError, SystemStatus as Status } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Server, Database, RefreshCw, ChevronDown } from "lucide-react";

function StatusCard({ label, ok, detail, icon: Icon }: { label: string; ok: boolean | null; detail?: string; icon: typeof Server }) {
  return (
    <div className="glass-panel rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          <span className="font-mono text-[10px] uppercase tracking-wider">{label}</span>
        </div>
        <span className={cn("h-2 w-2 rounded-full", ok === true ? "bg-success shadow-[0_0_8px_hsl(var(--success))]" : ok === false ? "bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]" : "bg-muted-foreground animate-pulse")} />
      </div>
      <div className={cn("mt-2 font-mono text-sm", ok === true ? "text-success" : ok === false ? "text-destructive" : "text-muted-foreground")}>
        {ok === true ? "HEALTHY" : ok === false ? "UNAVAILABLE" : "CHECKING…"}
      </div>
      {detail && <div className="font-mono text-[10px] text-muted-foreground mt-1 truncate">{detail}</div>}
    </div>
  );
}

export default function SystemStatusPage() {
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [sys, setSys] = useState<Status | null>(null);
  const [sysErr, setSysErr] = useState<string | null>(null);
  const [cache, setCache] = useState<unknown>(null);
  const [cacheErr, setCacheErr] = useState<string | null>(null);
  const [showCache, setShowCache] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    await Promise.allSettled([
      api.health().then(() => setHealthOk(true)).catch(() => setHealthOk(false)),
      api.systemStatus().then((s) => { setSys(s); setSysErr(null); }).catch((e: ApiError) => setSysErr(e.message)),
      api.debugCache().then((c) => { setCache(c); setCacheErr(null); }).catch((e: ApiError) => setCacheErr(e.message)),
    ]);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const neo4jOk = sys?.neo4j?.connected ?? null;

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase mb-1">// Admin · Diagnostics</div>
          <h1 className="text-2xl font-semibold">System Status</h1>
          <p className="text-sm text-muted-foreground mt-1">Live service and data connection health.</p>
        </div>
        <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-card/50 hover:border-primary/40 text-[12px] font-mono uppercase tracking-wider">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatusCard label="Core Service" ok={healthOk} icon={Server} detail="Application availability" />
        <StatusCard label="System Services" ok={sysErr ? false : sys ? true : null} icon={Server} detail={sysErr ?? (sys?.status as string | undefined) ?? "—"} />
        <StatusCard label="Neo4j Connection" ok={neo4jOk} icon={Database} detail={sys?.last_ingestion ? `Last ingestion: ${sys.last_ingestion}` : "—"} />
      </div>

      {sys && (
        <div className="glass-panel rounded-lg p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">System details</div>
          <pre className="font-mono text-[11px] overflow-auto max-h-[320px] text-foreground/80 bg-surface-2/40 rounded p-3">{JSON.stringify(sys, null, 2)}</pre>
        </div>
      )}

      <div className="border border-dashed border-border rounded-lg overflow-hidden">
        <button onClick={() => setShowCache((s) => !s)} className="w-full flex items-center justify-between px-4 py-3 text-left text-muted-foreground hover:bg-card/40">
          <span className="font-mono text-[11px] uppercase tracking-wider">Diagnostic cache</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", showCache && "rotate-180")} />
        </button>
        {showCache && (
          <div className="p-4 border-t border-border bg-surface-2/30">
            {cacheErr ? (<div className="text-sm text-destructive font-mono">{cacheErr}</div>) : (<pre className="font-mono text-[11px] overflow-auto max-h-[360px] text-foreground/80">{JSON.stringify(cache, null, 2)}</pre>)}
          </div>
        )}
      </div>
    </div>
  );
}
