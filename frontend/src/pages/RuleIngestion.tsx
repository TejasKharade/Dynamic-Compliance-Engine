import { useState } from "react";
import { api, ApiError, ExtractedRule } from "@/lib/api";
import { SeverityBadge } from "@/components/SeverityBadge";
import { cn } from "@/lib/utils";
import { Upload, FileText, AlertTriangle, Loader2, Database } from "lucide-react";
import { toast } from "sonner";

type Mode = "ingest" | "evaluate" | "neo4j";

export default function RuleIngestion() {
  const [mode, setMode] = useState<Mode>("ingest");
  const [ruleFiles, setRuleFiles] = useState<File[]>([]);
  const [inventoryFiles, setInventoryFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<ExtractedRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setRules(null);
    try {
      if (mode === "ingest") {
        if (!ruleFiles.length) { toast.error("Select at least one rule document"); return; }
        const res = await api.ingestRules(ruleFiles);
        setRules(res.rules ?? []);
        toast.success(`Extracted ${res.rules?.length ?? 0} rules`);
      } else if (mode === "evaluate") {
        const res = await api.evaluate({ rules: ruleFiles, inventory: inventoryFiles });
        toast.success(`Evaluated ${res.devices?.length ?? 0} devices`);
      } else {
        const res = await api.evaluateNeo4j({ rules: ruleFiles, inventory: inventoryFiles });
        toast.success(`Neo4j evaluation completed: ${res.devices?.length ?? 0} devices`);
      }
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div>
        <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase mb-1">// Pipeline</div>
        <h1 className="text-2xl font-semibold">Rule Management & Ingestion</h1>
        <p className="text-sm text-muted-foreground mt-1">Upload Dell compatibility documents and inventory files. Extract rules, run full pipeline, or persist to Neo4j.</p>
      </div>

      <div className="inline-flex rounded-md border border-border p-0.5 bg-card/50 flex-wrap">
        {([
          { v: "ingest", l: "Ingest Rules", e: "POST /ingest-rules" },
          { v: "evaluate", l: "Full Evaluate", e: "POST /evaluate" },
          { v: "neo4j", l: "Neo4j Evaluate", e: "POST /evaluate-neo4j" },
        ] as { v: Mode; l: string; e: string }[]).map((t) => (
          <button key={t.v} onClick={() => setMode(t.v)} className={cn("px-3 h-9 rounded text-[12px] font-medium", mode === t.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t.l}
            <span className="hidden md:inline ml-2 font-mono text-[10px] opacity-70">{t.e}</span>
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <FileDrop label="Compatibility Rule Documents" hint="PDF, TXT, or JSON" files={ruleFiles} onChange={setRuleFiles} accept=".pdf,.txt,.json,application/json,application/pdf" />
        {mode !== "ingest" && (<FileDrop label="Inventory Files" hint="JSON inventory dump(s)" files={inventoryFiles} onChange={setInventoryFiles} accept=".json,application/json" />)}
      </div>

      <button onClick={submit} disabled={busy} className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 disabled:opacity-60 glow-primary">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
        Run {mode === "ingest" ? "Ingestion" : mode === "evaluate" ? "Full Evaluation" : "Neo4j Evaluation"}
      </button>

      {error && (
        <div className="glass-panel rounded-lg p-4 border-l-2 border-destructive flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm text-destructive">{error}</div>
        </div>
      )}

      {rules && (
        <div className="glass-panel rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Extracted Rules</div>
              <div className="text-sm">{rules.length} rule{rules.length === 1 ? "" : "s"} parsed</div>
            </div>
          </div>
          <div className="grid grid-cols-12 px-4 py-2.5 border-b border-border bg-surface-2/40 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="col-span-3">Component A</div>
            <div className="col-span-3">Component B</div>
            <div className="col-span-2">Relationship</div>
            <div className="col-span-2">Constraint</div>
            <div className="col-span-1">Severity</div>
            <div className="col-span-1 text-right">Conf.</div>
          </div>
          <div className="divide-y divide-border max-h-[520px] overflow-auto scrollbar-thin">
            {rules.map((r, i) => {
              const low = (r.confidence ?? 1) < 0.7;
              return (
                <div key={i} className={cn("grid grid-cols-12 items-center px-4 py-2.5 text-[12px]", low && "bg-warning/5 border-l-2 border-warning")}>
                  <div className="col-span-3 font-mono">{r.component_a}</div>
                  <div className="col-span-3 font-mono">{r.component_b ?? "—"}</div>
                  <div className="col-span-2 font-mono uppercase text-[11px] text-primary">{r.relationship}</div>
                  <div className="col-span-2 font-mono text-muted-foreground">{r.version_constraint ?? "—"}</div>
                  <div className="col-span-1"><SeverityBadge severity={r.severity} /></div>
                  <div className="col-span-1 text-right font-mono"><span className={cn(low ? "text-warning" : "text-foreground")}>{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}</span></div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FileDrop({ label, hint, files, onChange, accept }: { label: string; hint: string; files: File[]; onChange: (f: File[]) => void; accept?: string }) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <label className="glass-panel rounded-lg p-6 flex flex-col items-center justify-center gap-2 cursor-pointer border-dashed hover:border-primary/50 transition-colors min-h-[140px]">
        <Upload className="h-5 w-5 text-muted-foreground" />
        <div className="text-[13px] text-foreground">Click to select files</div>
        <div className="font-mono text-[10px] text-muted-foreground">{hint}</div>
        <input type="file" multiple accept={accept} className="hidden" onChange={(e) => onChange(Array.from(e.target.files ?? []))} />
      </label>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-[12px] font-mono text-muted-foreground">
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span className="truncate">{f.name}</span>
              <span className="opacity-60">({Math.round(f.size / 1024)} KB)</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}