import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api, ApiError, DeviceEvaluation, ExtractedRule } from "@/lib/api";
import { SeverityBadge } from "@/components/SeverityBadge";
import { cn } from "@/lib/utils";
import {
  Upload,
  FileText,
  AlertTriangle,
  Loader2,
  Database,
  ShieldCheck,
  Server,
  Activity,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Settings,
  HelpCircle,
} from "lucide-react";
import { toast } from "sonner";


function scoreColor(score?: number) {
  if (score == null) return "text-muted-foreground";
  if (score >= 90) return "text-success";
  if (score >= 70) return "text-warning";
  return "text-destructive";
}

const SAMPLE_POLICY_TEXT = `DOCKER DESKTOP COMPLIANCE POLICY
Test Policy Document

Purpose: A set of corporate policy compliance requirements for deploying Docker Desktop on enterprise endpoints.

================================================================
1. CORE DOCKER DESKTOP SYSTEM REQUIREMENTS
================================================================

- Docker Desktop requires WSL 2.1.5 or newer on Windows endpoints to run the Linux container backend.
- Docker Desktop requires at least 8 GB RAM of system memory to ensure container runtime stability.
- Docker Desktop requires CPU Virtualization to be Enabled in system BIOS/UEFI.
- Docker Desktop is not supported on Windows Server operating systems due to license and container runtime incompatibilities.
`;

export default function PolicyPage() {
  const [ruleFiles, setRuleFiles] = useState<File[]>([]);
  const [inventoryFiles, setInventoryFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<DeviceEvaluation[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [policySummary, setPolicySummary] = useState<string | null>(null);

  // Load cached reports on mount
  const loadCachedReports = () => {
    api.getPolicyReports()
      .then((res) => {
        if (res.devices) setReports(res.devices);
        if (res.policy_summary) setPolicySummary(res.policy_summary);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadCachedReports();
  }, []);

  const loadSampleData = async () => {
    setBusy(true);
    setError(null);
    try {
      // 1. Fetch mock policy inventory from backend
      const mockInventory = await api.getMockPolicyInventory();
      
      // 2. Create sample rules file from hardcoded string
      const rulesBlob = new Blob([SAMPLE_POLICY_TEXT], { type: "text/plain" });
      const rulesFile = new File([rulesBlob], "docker_desktop_policy.txt", { type: "text/plain" });
      
      // 3. Create mock inventory file object
      const inventoryBlob = new Blob([JSON.stringify(mockInventory, null, 2)], { type: "application/json" });
      const inventoryFile = new File([inventoryBlob], "mock_policy_devices.json", { type: "application/json" });

      // 4. Run evaluate via API
      const res = await api.evaluatePolicy({
        rules: [rulesFile],
        inventory: [inventoryFile],
      });

      setReports(res.devices ?? []);
      if (res.policy_summary) setPolicySummary(res.policy_summary);
      toast.success("Loaded sample Docker Desktop policy and evaluated 5 mock devices successfully!");
    } catch (e) {
      setError((e as ApiError).message || "Failed to load sample data.");
      toast.error("Failed to execute sample policy evaluation.");
    } finally {
      setBusy(false);
    }
  };

  const submitEvaluation = async () => {
    if (!ruleFiles.length || !inventoryFiles.length) {
      toast.error("Please upload both a policy document and an inventory JSON file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.evaluatePolicy({
        rules: ruleFiles,
        inventory: inventoryFiles,
      });
      setReports(res.devices ?? []);
      if (res.policy_summary) setPolicySummary(res.policy_summary);
      toast.success(`Evaluated ${res.devices?.length ?? 0} devices against the policy rules.`);
    } catch (e) {
      setError((e as ApiError).message);
      toast.error("Policy evaluation run encountered an error.");
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(() => {
    const total = reports.length;
    const compliant = reports.filter((d) => d.is_compliant).length;
    const violationsCount = reports.reduce((acc, d) => acc + d.violations.length, 0);
    const criticalCount = reports.reduce((acc, d) => acc + d.violations.filter(v => v.severity === "CRITICAL").length, 0);
    return {
      total,
      compliantPercent: total ? Math.round((compliant / total) * 100) : 0,
      violationsCount,
      criticalCount,
    };
  }, [reports]);

  const filteredReports = useMemo(() => {
    if (severityFilter === "ALL") return reports;
    return reports.filter((d) =>
      d.violations.some((v) => v.severity.toUpperCase() === severityFilter)
    );
  }, [reports, severityFilter]);

  const activeDeviceData = useMemo(() => {
    if (!selectedDevice) return null;
    return reports.find((d) => d.device_id === selectedDevice) || null;
  }, [reports, selectedDevice]);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase mb-1">
            // Corporate Policies
          </div>
          <h1 className="text-2xl font-semibold">Product Policy Compliance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Evaluate host inventory against policy anchors (e.g. Docker Desktop requirements for WSL, memory, and virtualization).
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Button removed */}
        </div>
      </div>

      <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard icon={Server} label="Devices Evaluated" value={stats.total} tone="primary" />
            <SummaryCard
              icon={ShieldCheck}
              label="% Policy Compliant"
              value={stats.total ? `${stats.compliantPercent}%` : "—"}
              tone="success"
            />
            <SummaryCard icon={AlertTriangle} label="Critical Violations" value={stats.criticalCount} tone="critical" />
            <SummaryCard icon={Activity} label="Total Policy Warnings" value={stats.violationsCount} tone="warning" />
          </div>

          {/* Upload panel */}
          <div className="glass-panel p-5 rounded-lg border border-border space-y-4">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <Upload className="h-4 w-4" />
              <span>Evaluate Custom Policy Ruleset</span>
            </div>
            
            <div className="grid md:grid-cols-2 gap-4">
              <FileDrop
                label="Policy Document"
                hint="TXT or PDF (e.g., Docker desktop installation specs)"
                files={ruleFiles}
                onChange={setRuleFiles}
                accept=".txt,.pdf"
                allowText={false}
              />
              <FileDrop
                label="Host Inventory"
                hint="Raw text or TXT file"
                files={inventoryFiles}
                onChange={setInventoryFiles}
                accept=".txt"
                allowText={true}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={submitEvaluation}
                disabled={busy}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors glow-primary"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Evaluate Policy Compliance
              </button>
            </div>
          </div>

          {error && (
            <div className="glass-panel rounded-lg p-4 border-l-2 border-destructive flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm text-destructive">{error}</div>
            </div>
          )}

          {policySummary && (
            <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background p-8 shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-xl transition-all duration-500 hover:shadow-[0_8px_40px_rgba(var(--primary),0.15)] group animate-in fade-in slide-in-from-bottom-4">
              {/* Background decorative elements */}
              <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl group-hover:bg-primary/10 transition-colors duration-500" />
              <div className="absolute -left-20 -bottom-20 h-48 w-48 rounded-full bg-secondary/5 blur-3xl group-hover:bg-secondary/10 transition-colors duration-500" />
              
              <div className="relative z-10 space-y-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-inner">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                      LLM Policy Compliance Summary Report
                    </h2>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-primary/80 mt-0.5">
                      AI Generated Analysis
                    </div>
                  </div>
                </div>

                <div className={cn(
                  "prose prose-sm max-w-none mt-6 pl-4 border-l-2 border-primary/20",
                  "dark:prose-invert",
                  "prose-p:leading-relaxed prose-p:text-foreground/90",
                  "prose-headings:text-foreground prose-headings:font-bold prose-headings:tracking-tight",
                  "prose-strong:text-primary prose-strong:font-semibold",
                  "prose-ul:space-y-1.5 prose-li:text-foreground/90 prose-li:marker:text-primary",
                  "prose-code:text-primary prose-code:bg-primary/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[12px] prose-code:font-medium prose-code:before:content-none prose-code:after:content-none",
                  "prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/10 prose-pre:shadow-xl prose-pre:text-[12px]",
                  "prose-blockquote:text-muted-foreground prose-blockquote:border-l-primary prose-blockquote:bg-primary/5 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-blockquote:italic"
                )}>
                  <ReactMarkdown>{policySummary}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* Dashboard Table */}
          <div className="grid lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mr-2">
                    Filter:
                  </span>
                  {["ALL", "CRITICAL", "WARNING", "INFO"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSeverityFilter(s)}
                      className={cn(
                        "px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded border transition-colors",
                        severityFilter === s
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="glass-panel rounded-lg overflow-hidden border border-border">
                <div className="grid grid-cols-12 px-4 py-2.5 border-b border-border bg-surface-2/40 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <div className="col-span-6">Device</div>
                  <div className="col-span-2">Policy Score</div>
                  <div className="col-span-4 text-right">Checks Status</div>
                </div>

                {filteredReports.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground text-sm space-y-2">
                    <CheckCircle className="h-8 w-8 text-success mx-auto opacity-70" />
                    <div>No policy records. Load sample data or upload files above.</div>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredReports.map((d) => {
                      const counts = d.violations.reduce((acc, v) => {
                        acc[v.severity] = (acc[v.severity] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>);

                      return (
                        <div
                          key={d.device_id}
                          onClick={() => setSelectedDevice(d.device_id === selectedDevice ? null : d.device_id)}
                          className={cn(
                            "grid grid-cols-12 items-center px-4 py-3 cursor-pointer hover:bg-surface-2/40 transition-colors",
                            d.device_id === selectedDevice && "bg-surface-2/60"
                          )}
                        >
                          <div className="col-span-6 flex items-center gap-3">
                            <Server className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-[13px] font-medium truncate">{d.device_id}</span>
                          </div>
                          <div className="col-span-2">
                            <span className={cn("font-mono text-[16px] font-bold", scoreColor(d.compliance_score))}>
                              {d.compliance_score}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground ml-1">/100</span>
                          </div>
                          <div className="col-span-4 flex justify-end gap-1.5">
                            {d.violations.length === 0 ? (
                              <span className="text-[11px] text-success font-mono">PASSING</span>
                            ) : (
                              Object.entries(counts).map(([sev, n]) => (
                                <span key={sev} className="inline-flex items-center gap-1">
                                  <SeverityBadge severity={sev} />
                                  <span className="font-mono text-[11px] text-muted-foreground">×{n}</span>
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Drilldown panel */}
            <div className="lg:col-span-5">
              {activeDeviceData ? (
                <div className="glass-panel p-5 rounded-lg border border-border space-y-5 animate-in fade-in slide-in-from-right-4 duration-200">
                  <div className="flex items-start justify-between border-b border-border pb-3">
                    <div>
                      <h3 className="text-md font-semibold truncate max-w-[280px]">
                        {activeDeviceData.device_id}
                      </h3>
                      <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        SPECIFICATIONS SUMMARY
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn("font-mono text-2xl font-bold", scoreColor(activeDeviceData.compliance_score))}>
                        {activeDeviceData.compliance_score}
                      </div>
                      <div className="text-[10px] text-muted-foreground uppercase font-mono">Score</div>
                    </div>
                  </div>

                  {/* Device Specs list */}
                  <div className="space-y-2">
                    <h4 className="font-mono text-[10px] uppercase text-muted-foreground">Installed Properties</h4>
                    <div className="grid grid-cols-2 gap-2 text-[12px] p-2.5 rounded bg-card/40 border border-border/50">
                      {activeDeviceData.specs && activeDeviceData.specs.length > 0 ? (
                        activeDeviceData.specs.map((s, idx) => (
                          <div key={idx} className="flex justify-between border-b border-border/20 pb-1">
                            <span className="font-mono text-muted-foreground">{s.component}:</span>
                            <span className="font-semibold truncate">{s.version}</span>
                          </div>
                        ))
                      ) : (
                        <div className="col-span-2 text-center text-muted-foreground text-[11px]">
                          No component specifications available.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Violations List */}
                  <div className="space-y-3">
                    <h4 className="font-mono text-[10px] uppercase text-muted-foreground">
                      Policy Findings ({activeDeviceData.violations.length})
                    </h4>
                    
                    {activeDeviceData.violations.length === 0 ? (
                      <div className="flex items-center gap-2 p-3 bg-success/5 border border-success/20 rounded text-success text-sm">
                        <CheckCircle className="h-4 w-4 shrink-0" />
                        <span>All corporate policies verified successfully.</span>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[300px] overflow-auto pr-1">
                        {activeDeviceData.violations.map((v, i) => (
                          <div key={i} className="p-3 border border-border rounded bg-card/60 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[10px] text-primary uppercase font-medium">
                                {v.rule_id}
                              </span>
                              <SeverityBadge severity={v.severity} />
                            </div>
                            <p className="text-[12px] font-medium leading-relaxed">
                              {v.message}
                            </p>
                            {v.explanation && (
                              <p className="text-[11px] text-muted-foreground italic leading-relaxed">
                                {v.explanation}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Remediation steps */}
                  {activeDeviceData.remediation && activeDeviceData.remediation.length > 0 && (
                    <div className="space-y-3 border-t border-border pt-4">
                      <h4 className="font-mono text-[10px] uppercase text-muted-foreground">
                        Remediation Action Plan
                      </h4>
                      <div className="space-y-3 pr-1">
                        {activeDeviceData.remediation.map((step, idx) => (
                          <div key={idx} className="space-y-2 border border-border/80 rounded p-3 bg-surface-2/20">
                            <div className="flex justify-between items-center text-[12px] font-semibold border-b border-border/30 pb-1.5">
                              <span>Step {step.order}: {step.action}</span>
                              {step.estimated_time && (
                                <span className="font-mono text-[10px] text-muted-foreground uppercase">
                                  {step.estimated_time}
                                </span>
                              )}
                            </div>
                            {step.reason && (
                              <p className="text-[11px] text-muted-foreground">{step.reason}</p>
                            )}
                            {step.sub_steps && step.sub_steps.length > 0 && (
                              <div className="space-y-1.5 mt-2 pl-1.5 border-l border-primary/20">
                                {step.sub_steps.map((sub, sIdx) => (
                                  <div key={sIdx} className="text-[11px] space-y-1">
                                    <div className="text-foreground">
                                      <span className="font-semibold">{sub.order}.</span> {sub.description}
                                    </div>
                                    {sub.command && (
                                      <pre className="font-mono text-[9px] bg-black/40 text-primary-foreground p-1.5 rounded select-all whitespace-pre-wrap leading-tight border border-border/30">
                                        {sub.command}
                                      </pre>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="glass-panel p-8 rounded-lg border border-dashed border-border flex flex-col items-center justify-center text-center text-muted-foreground min-h-[300px]">
                  <HelpCircle className="h-8 w-8 mb-2 opacity-50" />
                  <div className="text-sm font-medium">Select a device record</div>
                  <p className="text-xs max-w-[200px] mt-1">
                    Click on a host from the table to inspect specifications, failing checks, and remediation instructions.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Server;
  label: string;
  value: string | number;
  tone: "primary" | "success" | "critical" | "warning";
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
      <div className={cn("font-mono text-2xl font-semibold tabular-nums", toneColors[tone])}>
        {value}
      </div>
    </div>
  );
}

function FileDrop({
  label,
  hint,
  files,
  onChange,
  accept,
  allowText = false,
}: {
  label: string;
  hint: string;
  files: File[];
  onChange: (f: File[]) => void;
  accept?: string;
  allowText?: boolean;
}) {
  const [mode, setMode] = useState<"file" | "text">("file");
  const [textVal, setTextVal] = useState("");

  useEffect(() => {
    if (mode === "text") {
      if (textVal.trim()) {
        const blob = new Blob([textVal], { type: "text/plain" });
        const filename = accept?.includes(".json") ? "pasted_input.json" : "pasted_input.txt";
        const f = new File([blob], filename, { type: "text/plain" });
        onChange([f]);
      } else {
        onChange([]);
      }
    }
  }, [textVal, mode]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {allowText && (
          <div className="flex gap-1 bg-surface-2/40 p-0.5 rounded border border-border">
            <button
              onClick={() => { setMode("file"); onChange([]); setTextVal(""); }}
              className={cn("px-2 py-0.5 text-[9px] font-mono uppercase rounded transition-colors", mode === "file" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              File
            </button>
            <button
              onClick={() => { setMode("text"); onChange([]); }}
              className={cn("px-2 py-0.5 text-[9px] font-mono uppercase rounded transition-colors", mode === "text" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              Text
            </button>
          </div>
        )}
      </div>
      
      {mode === "file" ? (
        <>
          <label className="glass-panel rounded-lg p-5 flex flex-col items-center justify-center gap-1.5 cursor-pointer border-dashed hover:border-primary/50 transition-colors min-h-[120px] bg-card/30">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <div className="text-[12px] text-foreground font-medium">Select file</div>
            <div className="font-mono text-[9px] text-muted-foreground text-center">
              {hint}
            </div>
            <input
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => onChange(Array.from(e.target.files ?? []))}
            />
          </label>
          {files.length > 0 && files[0].name !== "pasted_input.json" && files[0].name !== "pasted_input.txt" && (
            <ul className="space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                  <FileText className="h-3 w-3 text-primary" />
                  <span className="truncate max-w-[200px]">{f.name}</span>
                  <span className="opacity-60">({Math.round(f.size / 1024)} KB)</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <textarea
          className="w-full h-[120px] bg-card/30 border border-border rounded-lg p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
          placeholder="Paste content here..."
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
        />
      )}
    </div>
  );
}
