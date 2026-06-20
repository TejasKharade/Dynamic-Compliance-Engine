import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, DeviceEvaluation, DeviceSpec } from "@/lib/api";
import { SeverityBadge } from "@/components/SeverityBadge";
import { cn } from "@/lib/utils";
import { ArrowLeft, RefreshCw, Sparkles, AlertTriangle, Upload, Plus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

function scoreColor(score?: number) {
  if (score == null) return "text-muted-foreground";
  if (score >= 90) return "text-success";
  if (score >= 70) return "text-warning";
  return "text-destructive";
}

export default function DeviceDrilldown() {
  const { deviceId } = useParams();
  const [device, setDevice] = useState<DeviceEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<unknown>(null);
  const [manualSpecs, setManualSpecs] = useState<DeviceSpec[]>([]);

  const load = async () => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.evaluateInventory({});
      const found = res.devices?.find((d) => d.device_id === decodeURIComponent(deviceId));
      setDevice(found ?? { device_id: decodeURIComponent(deviceId), violations: [] });
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const loadImpact = async () => {
    if (!deviceId) return;
    try {
      const res = await api.impact({ device_id: decodeURIComponent(deviceId) });
      setImpact(res);
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  };

  const handleAddSpec = (s: DeviceSpec) => setManualSpecs((m) => [...m, s]);

  const handleInventoryUpload: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const inventory = JSON.parse(text);
      await api.evaluateJson({ inventory });
      toast.success("Inventory submitted for re-evaluation");
      load();
    } catch {
      toast.error("Failed to parse/upload inventory JSON");
    }
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-[12px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Fleet
      </Link>

      <div className="glass-panel rounded-lg p-6 flex items-start justify-between gap-6 flex-wrap">
        <div className="space-y-1">
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">// Device</div>
          <h1 className="text-2xl font-semibold">{device?.name ?? device?.device_id ?? deviceId}</h1>
          <div className="font-mono text-[11px] text-muted-foreground">{device?.device_id}</div>
          {device?.last_evaluated && (<div className="font-mono text-[11px] text-muted-foreground mt-2">Last evaluated: {device.last_evaluated}</div>)}
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Compliance Score</div>
            <div className={cn("font-mono text-5xl font-semibold tabular-nums", scoreColor(device?.compliance_score))}>
              {device?.compliance_score ?? "—"}
              <span className="text-lg text-muted-foreground font-normal">/100</span>
            </div>
          </div>
          <button onClick={load} className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Re-evaluate
          </button>
        </div>
      </div>

      {error && (
        <div className="glass-panel rounded-lg p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <div className="text-sm text-destructive">{error}</div>
        </div>
      )}

      <Tabs defaultValue="violations" className="w-full">
        <TabsList className="bg-card/50 border border-border">
          <TabsTrigger value="violations" className="font-mono text-[11px] uppercase tracking-wider">Violations</TabsTrigger>
          <TabsTrigger value="remediation" className="font-mono text-[11px] uppercase tracking-wider">Remediation</TabsTrigger>
          <TabsTrigger value="specs" className="font-mono text-[11px] uppercase tracking-wider">Specs</TabsTrigger>
          <TabsTrigger value="impact" onClick={loadImpact} className="font-mono text-[11px] uppercase tracking-wider">Impact</TabsTrigger>
        </TabsList>

        <TabsContent value="violations" className="mt-4 space-y-2">
          {loading ? (<Skeleton className="h-32 w-full" />)
            : (device?.violations ?? []).length === 0 ? (
              <div className="glass-panel rounded-lg p-8 text-center text-success">✓ No violations on this device.</div>
            ) : (
              (device?.violations ?? []).map((v, i) => (
                <div key={i} className="glass-panel rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SeverityBadge severity={String(v.severity)} />
                    {v.rule_id && (<span className="font-mono text-[11px] text-muted-foreground">{v.rule_id}</span>)}
                  </div>
                  <div className="text-sm font-medium">{v.message}</div>
                  {v.explanation && (
                    <div className="flex gap-2 p-3 rounded border border-ai/30 bg-ai/5">
                      <Sparkles className="h-4 w-4 text-ai shrink-0 mt-0.5" />
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-wider text-ai mb-1">AI Explanation</div>
                        <div className="text-[13px] text-foreground/90">{v.explanation}</div>
                      </div>
                    </div>
                  )}
                  {v.source && (
                    <div className="font-mono text-[11px] text-muted-foreground">
                      Source: {v.source.document}{v.source.page ? ` p.${v.source.page}` : ""}
                    </div>
                  )}
                </div>
              ))
            )}
        </TabsContent>

        <TabsContent value="remediation" className="mt-4">
          {(device?.remediation ?? []).length === 0 ? (
            <div className="glass-panel rounded-lg p-8 text-center text-muted-foreground">No remediation plan available.</div>
          ) : (
            <ol className="glass-panel rounded-lg divide-y divide-border">
              {device!.remediation!.map((s, i) => (
                <li key={i} className="p-4 flex gap-4">
                  <div className="font-mono text-primary text-lg font-semibold w-6">{s.order ?? i + 1}.</div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{s.action}</div>
                    <div className="flex gap-4 mt-1 text-[11px] font-mono text-muted-foreground">
                      {s.estimated_time && <span>⏱ {s.estimated_time}</span>}
                      {s.risk && <span>RISK: <span className="text-warning">{s.risk}</span></span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        <TabsContent value="specs" className="mt-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <ManualSpecForm onAdd={handleAddSpec} />
            <label className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-border hover:border-primary/40 cursor-pointer text-[12px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground">
              <Upload className="h-3.5 w-3.5" />
              Upload Inventory JSON
              <input type="file" accept=".json,application/json" className="hidden" onChange={handleInventoryUpload} />
            </label>
          </div>
          <SpecsTable specs={[...(device?.specs ?? []), ...manualSpecs]} loading={loading} />
        </TabsContent>

        <TabsContent value="impact" className="mt-4">
          <div className="glass-panel rounded-lg p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Impact Analysis (GET /impact)</div>
            {!impact ? (
              <div className="text-sm text-muted-foreground">Loading impact data…</div>
            ) : (
              <pre className="font-mono text-[11px] overflow-auto max-h-[480px] text-foreground/80 bg-surface-2/40 rounded p-3">{JSON.stringify(impact, null, 2)}</pre>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SpecsTable({ specs, loading }: { specs: DeviceSpec[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (specs.length === 0)
    return (<div className="glass-panel rounded-lg p-8 text-center text-muted-foreground text-sm">No specs detected yet. Add one manually or upload an inventory file.</div>);
  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="grid grid-cols-12 px-4 py-2.5 border-b border-border bg-surface-2/40 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <div className="col-span-5">Component</div>
        <div className="col-span-4">Version</div>
        <div className="col-span-3 text-right">Source</div>
      </div>
      <div className="divide-y divide-border">
        {specs.map((s, i) => {
          const isManual = s.source === "manual";
          return (
            <div key={i} className="grid grid-cols-12 items-center px-4 py-2.5">
              <div className="col-span-5 text-[13px]">{s.component}</div>
              <div className="col-span-4 font-mono text-[12px] text-foreground/90">{s.version}</div>
              <div className="col-span-3 flex items-center justify-end gap-2">
                {s.confidence != null && !isManual && (<span className="font-mono text-[10px] text-muted-foreground">{Math.round((s.confidence ?? 0) * 100)}%</span>)}
                <span className={cn("px-1.5 py-0.5 rounded-sm border font-mono text-[10px] uppercase tracking-wider", isManual ? "border-info/40 text-info bg-info/5" : "border-ai/40 text-ai bg-ai/5")}>{isManual ? "Manual" : "Auto"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ManualSpecForm({ onAdd }: { onAdd: (s: DeviceSpec) => void }) {
  const [component, setComponent] = useState("");
  const [version, setVersion] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!component || !version) return;
        onAdd({ component, version, source: "manual" });
        setComponent("");
        setVersion("");
      }}
      className="flex items-center gap-2"
    >
      <input value={component} onChange={(e) => setComponent(e.target.value)} placeholder="Component (BIOS, iDRAC…)" className="h-9 px-3 rounded-md border border-border bg-card/50 text-[13px] outline-none focus:border-primary" />
      <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version" className="h-9 px-3 rounded-md border border-border bg-card/50 text-[13px] font-mono outline-none focus:border-primary w-32" />
      <button type="submit" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90">
        <Plus className="h-3.5 w-3.5" /> Add Spec
      </button>
    </form>
  );
}