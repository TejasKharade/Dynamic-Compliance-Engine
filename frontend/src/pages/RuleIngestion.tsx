import { useState } from "react";
import { api, ApiError, ExtractedRule } from "@/lib/api";
import { SeverityBadge } from "@/components/SeverityBadge";
import { cn } from "@/lib/utils";
import { Upload, FileText, AlertTriangle, Loader2, Database, CheckCircle, Network, BrainCircuit, Activity } from "lucide-react";
import { toast } from "sonner";

type Mode = "ingest" | "evaluate";

export default function RuleIngestion() {
  const [mode, setMode] = useState<Mode>("ingest");
  const [ruleFiles, setRuleFiles] = useState<File[]>([]);
  const [inventoryFiles, setInventoryFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<ExtractedRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSuccessMessage(null);
    setRules(null);
    try {
      if (mode === "ingest") {
        if (!ruleFiles.length) { toast.error("Select at least one rule document"); return; }
        const res = await api.ingestRules(ruleFiles);
        setRules(res.rules ?? []);
        setSuccessMessage(`Successfully extracted ${res.rules?.length ?? 0} rules and pushed them to the Neo4j Knowledge Graph.`);
      } else {
        if (!ruleFiles.length) { toast.error("Select a rules file"); return; }
        if (!inventoryFiles.length) { toast.error("Select an inventory file"); return; }
        const res = await api.evaluate({ rules: ruleFiles, inventory: inventoryFiles });
        setSuccessMessage(`Successfully evaluated ${res.devices?.length ?? 0} devices. The Knowledge Graph has been updated with the latest compliance reports.`);
      }
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-[80vh] p-6 max-w-[1400px] mx-auto space-y-8 animate-in fade-in duration-700">
      {/* Decorative Background Elements */}
      <div className="pointer-events-none absolute left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[100px]" />
      <div className="pointer-events-none absolute right-0 bottom-0 h-[400px] w-[400px] translate-x-1/3 translate-y-1/3 rounded-full bg-secondary/10 blur-[100px]" />
      
      <div className="relative z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-mono tracking-[0.2em] text-primary uppercase mb-4 shadow-sm">
          <Database className="h-3 w-3" /> // Intelligence Pipeline
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-foreground/50 bg-clip-text text-transparent">
          Rule Management & Ingestion
        </h1>
        <p className="text-base text-muted-foreground mt-2 max-w-2xl leading-relaxed">
          Upload Dell compatibility documents and inventory files. Extract rules, run full pipeline, or persist to the Neo4j Knowledge Graph.
        </p>
      </div>

      <div className="relative z-10 inline-flex rounded-xl border border-border/50 p-1 bg-card/60 backdrop-blur-md shadow-sm">
        {([
          { v: "ingest",   l: "Ingest Rules", desc: "Extract & push to Neo4j" },
          { v: "evaluate", l: "Evaluate + Graph", desc: "Evaluate inventory & sync" },
        ] as { v: Mode; l: string; desc: string }[]).map((t) => (
          <button key={t.v} onClick={() => { setMode(t.v); setSuccessMessage(null); setError(null); }} className={cn("relative px-6 py-2.5 rounded-lg text-[13px] font-semibold flex flex-col items-start transition-all duration-300", mode === t.v ? "bg-primary text-primary-foreground shadow-md scale-[1.02]" : "text-muted-foreground hover:text-foreground hover:bg-surface-2/40")}>
            <span>{t.l}</span>
            <span className={cn("text-[10px] font-normal mt-0.5 opacity-80 font-mono tracking-tight", mode === t.v ? "text-primary-foreground/80" : "text-muted-foreground")}>{t.desc}</span>
          </button>
        ))}
      </div>

      {successMessage && (
        <div className="glass-panel p-5 rounded-lg border-l-4 border-l-success bg-success/5 animate-in slide-in-from-top-2 duration-300 flex items-start gap-3 shadow-sm">
          <CheckCircle className="h-5 w-5 text-success shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-success">Pipeline Execution Complete</h3>
            <p className="text-sm text-foreground mt-1">{successMessage}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="glass-panel rounded-lg p-5 border-l-4 border-l-destructive bg-destructive/5 animate-in slide-in-from-top-2 flex items-start gap-3 shadow-sm">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-destructive">Pipeline Error</h3>
            <div className="text-sm text-foreground mt-1">{error}</div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <FileDrop label="Compatibility Rule Documents" hint="PDF, TXT, or JSON" files={ruleFiles} onChange={setRuleFiles} accept=".pdf,.txt,.json,application/json,application/pdf" />
            {mode === "evaluate" ? (
              <FileDrop label="Inventory Files" hint="JSON inventory dump(s)" files={inventoryFiles} onChange={setInventoryFiles} accept=".json,application/json" />
            ) : (
              <div className="glass-panel rounded-xl p-6 flex flex-col items-center justify-center text-center border border-dashed border-border/50 bg-card/20 min-h-[140px] opacity-70">
                <Network className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                <div className="text-sm font-medium text-muted-foreground">Inventory Skipped</div>
                <div className="text-xs text-muted-foreground mt-1 max-w-[200px]">Inventory is not required for rule extraction. Switch to "Evaluate" mode to upload host data.</div>
              </div>
            )}
          </div>

          <button onClick={submit} disabled={busy} className="inline-flex items-center justify-center gap-2 h-11 px-8 rounded-md bg-primary text-primary-foreground text-[14px] font-medium hover:bg-primary/90 disabled:opacity-60 transition-all glow-primary w-full md:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            {mode === "ingest" ? "Extract & Push to Neo4j" : "Run Full Evaluation Pipeline"}
          </button>

          {rules && (
            <div className="glass-panel rounded-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 shadow-sm border border-border">
              <div className="px-5 py-4 border-b border-border bg-card/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Extracted Rules Graph Data</span>
                </div>
                <div className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">{rules.length} Rules Parsed</div>
              </div>
              <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border bg-surface-2/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <div className="col-span-3">Component A</div>
                <div className="col-span-3">Component B</div>
                <div className="col-span-2">Relationship</div>
                <div className="col-span-2">Constraint</div>
                <div className="col-span-1">Severity</div>
                <div className="col-span-1 text-right">Conf.</div>
              </div>
              <div className="divide-y divide-border max-h-[400px] overflow-auto scrollbar-thin">
                {rules.map((r, i) => {
                  const low = (r.confidence ?? 1) < 0.7;
                  return (
                    <div key={i} className={cn("grid grid-cols-12 items-center px-5 py-3 text-[12px] hover:bg-surface-2/40 transition-colors", low && "bg-warning/5 border-l-2 border-warning")}>
                      <div className="col-span-3 font-mono font-medium">{r.component_a}</div>
                      <div className="col-span-3 font-mono">{r.component_b ?? "—"}</div>
                      <div className="col-span-2 font-mono uppercase text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary inline-block w-fit">{r.relationship}</div>
                      <div className="col-span-2 font-mono text-muted-foreground">{r.version_constraint ?? "—"}</div>
                      <div className="col-span-1"><SeverityBadge severity={r.severity} /></div>
                      <div className="col-span-1 text-right font-mono"><span className={cn(low ? "text-warning font-semibold" : "text-foreground")}>{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}</span></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Info Side Panel */}
        <div className="lg:col-span-4 space-y-6">
          <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card/80 via-card/40 to-background p-6 shadow-xl backdrop-blur-xl group">
            <div className="absolute top-0 right-0 p-4 opacity-10 transition-opacity duration-500 group-hover:opacity-20">
              <BrainCircuit className="h-24 w-24 text-primary" />
            </div>
            
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-8">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-inner">
                  <BrainCircuit className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-foreground tracking-tight">Intelligence Flow</h3>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-0.5">How it works</div>
                </div>
              </div>
              
              <div className="space-y-8 relative before:absolute before:inset-0 before:ml-[1.125rem] before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-primary/50 before:via-border before:to-transparent">
                <div className="relative flex items-start group/step">
                  <div className="flex items-center justify-center w-9 h-9 rounded-full border-2 border-primary bg-background shrink-0 text-xs font-bold text-primary shadow-[0_0_15px_rgba(var(--primary),0.3)] z-10 transition-transform duration-300 group-hover/step:scale-110 group-hover/step:bg-primary group-hover/step:text-primary-foreground">1</div>
                  <div className="ml-4 pt-1.5">
                    <strong className="text-sm text-foreground block tracking-tight mb-1">Upload Documents</strong>
                    <p className="text-xs text-muted-foreground leading-relaxed">Raw OEM spec sheets or PDFs are uploaded securely to the engine.</p>
                  </div>
                </div>
                
                <div className="relative flex items-start group/step">
                  <div className="flex items-center justify-center w-9 h-9 rounded-full border-2 border-primary bg-background shrink-0 text-xs font-bold text-primary shadow-[0_0_15px_rgba(var(--primary),0.3)] z-10 transition-transform duration-300 group-hover/step:scale-110 group-hover/step:bg-primary group-hover/step:text-primary-foreground">2</div>
                  <div className="ml-4 pt-1.5">
                    <strong className="text-sm text-foreground block tracking-tight mb-1">LLM Extraction</strong>
                    <p className="text-xs text-muted-foreground leading-relaxed">The LLM parses the documents into structured JSON constraint rules.</p>
                  </div>
                </div>
                
                <div className="relative flex items-start group/step">
                  <div className="flex items-center justify-center w-9 h-9 rounded-full border-2 border-primary bg-background shrink-0 text-xs font-bold text-primary shadow-[0_0_15px_rgba(var(--primary),0.3)] z-10 transition-transform duration-300 group-hover/step:scale-110 group-hover/step:bg-primary group-hover/step:text-primary-foreground">3</div>
                  <div className="ml-4 pt-1.5">
                    <strong className="text-sm text-foreground block tracking-tight mb-1">Graph Population</strong>
                    <p className="text-xs text-muted-foreground leading-relaxed">Nodes and edges are persisted to the Neo4j Knowledge Graph.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="glass-panel p-6 rounded-2xl border border-border/50 shadow-lg backdrop-blur-md bg-card/40 hover:bg-card/60 transition-colors">
             <div className="flex items-center gap-2 mb-4 text-muted-foreground">
                <Activity className="h-4 w-4" />
                <span className="font-mono text-[11px] uppercase tracking-wider font-semibold">System Status</span>
             </div>
             <div className="flex items-center justify-between">
                <span className="text-sm text-foreground font-medium">Neo4j Connection</span>
                <span className="flex items-center gap-2 text-success font-mono text-[11px] font-bold bg-success/10 px-3 py-1 rounded-md border border-success/20 shadow-[0_0_15px_rgba(var(--success),0.1)]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                  </span>
                  ONLINE
                </span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileDrop({ label, hint, files, onChange, accept }: { label: string; hint: string; files: File[]; onChange: (f: File[]) => void; accept?: string }) {
  return (
    <div className="space-y-2 group/drop">
      <div className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground mb-3">{label}</div>
      <label className="glass-panel relative overflow-hidden rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer border-dashed border-2 hover:border-primary/60 transition-all duration-300 min-h-[160px] shadow-sm hover:shadow-md bg-card/20 hover:bg-primary/5">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-0 group-hover/drop:opacity-100 transition-opacity duration-500" />
        <div className="relative z-10 flex flex-col items-center">
          <div className="h-12 w-12 rounded-full bg-background border border-border flex items-center justify-center mb-2 shadow-sm group-hover/drop:scale-110 group-hover/drop:border-primary/50 group-hover/drop:text-primary transition-all duration-300">
            <Upload className="h-5 w-5 text-muted-foreground group-hover/drop:text-primary transition-colors" />
          </div>
          <div className="text-[14px] text-foreground font-semibold">Click to select files</div>
          <div className="font-mono text-[11px] text-muted-foreground/80 mt-1">{hint}</div>
        </div>
        <input type="file" multiple accept={accept} className="hidden" onChange={(e) => onChange(Array.from(e.target.files ?? []))} />
      </label>
      {files.length > 0 && (
        <ul className="space-y-2 mt-3">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-3 text-[12px] font-mono text-muted-foreground bg-card/60 backdrop-blur-sm px-4 py-2.5 rounded-xl border border-border/50 shadow-sm animate-in fade-in slide-in-from-top-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <span className="truncate font-medium text-foreground">{f.name}</span>
              <span className="opacity-60 ml-auto">({Math.round(f.size / 1024)} KB)</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
