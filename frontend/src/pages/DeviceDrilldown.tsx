import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api, ApiError, DeviceEvaluation, DeviceSpec, RemediationSubStep, ChatResponse } from "@/lib/api";
import { SeverityBadge } from "@/components/SeverityBadge";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, RefreshCw, Sparkles, AlertTriangle, Upload, Plus,
  ChevronDown, Terminal, TriangleAlert, Info, Clock, Send,
  Loader2, MessageSquare, X, Cpu, Server, Download, FileText
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

function scoreColor(score?: number) {
  if (score == null) return "text-muted-foreground";
  if (score >= 90) return "text-success";
  if (score >= 70) return "text-warning";
  return "text-destructive";
}

// ─── Floating Remediation Chatbot ───────────────────────────────────────────

type ChatMsg = { role: "user" | "assistant"; content: string };

function RemediationChatbot({ device }: { device: DeviceEvaluation | null }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const deviceCtx = device
    ? `Device: ${device.device_id}, Score: ${device.compliance_score}/100, Violations: ${device.violations?.length ?? 0}`
    : "No device loaded.";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) {
      if (messages.length === 0) {
        setMessages([{
          role: "assistant",
          content: `Hello! I'm your **Remediation Assistant** for **${device?.device_id ?? "this device"}**.\n\nAsk me anything about the violations, remediation steps, or how to fix compliance issues on this device.`,
        }]);
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: ChatMsg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res: ChatResponse = await api.chat({
        question: `[Context: ${deviceCtx}] ${text}`,
        session_id: `remediation-${device?.device_id ?? "default"}`,
      });
      setMessages((m) => [...m, { role: "assistant", content: res.answer ?? "(no response)" }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ Error: ${(e as ApiError).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      <div className="fixed bottom-6 right-6 z-50 relative group">
        <div className={cn("absolute -inset-1 rounded-full bg-gradient-to-r from-ai via-primary to-ai opacity-50 blur group-hover:opacity-100 transition-opacity duration-300", open && "opacity-0")} />
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "relative h-14 w-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300",
            "bg-gradient-to-br from-ai to-ai/80 border border-ai/40",
            "hover:scale-110 active:scale-95",
            open && "rotate-180 scale-95 from-muted to-muted border-border",
          )}
          title="Remediation Assistant"
        >
          {open
            ? <X className="h-6 w-6 text-foreground" />
            : <MessageSquare className="h-6 w-6 text-white" />}
        </button>
      </div>

      {/* Chat panel */}
      {open && (
        <div className={cn(
          "fixed bottom-24 right-6 z-50 w-[380px] max-h-[520px]",
          "flex flex-col rounded-2xl border border-ai/30 shadow-2xl overflow-hidden",
          "bg-background/95 backdrop-blur-xl",
        )}>
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-ai/5">
            <div className="h-8 w-8 rounded-lg grid place-items-center bg-ai/20 border border-ai/40">
              <Sparkles className="h-4 w-4 text-ai" />
            </div>
            <div>
              <div className="text-[13px] font-semibold">Remediation Assistant</div>
              <div className="font-mono text-[10px] text-ai">AI · Context-aware</div>
            </div>
            <button onClick={() => setOpen(false)} className="ml-auto text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-auto p-4 space-y-3 scrollbar-thin min-h-0">
            {messages.map((m, i) => (
              <div key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" && (
                  <div className="h-6 w-6 rounded-md grid place-items-center bg-ai/15 border border-ai/30 shrink-0 mt-0.5">
                    <Sparkles className="h-3 w-3 text-ai" />
                  </div>
                )}
                <div className={cn(
                  "max-w-[88%] px-3 py-2 rounded-xl text-[12.5px] leading-relaxed",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-card border border-border text-foreground/90 rounded-bl-sm",
                )}>
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-p:text-foreground prose-pre:text-[11px] prose-code:text-ai prose-code:before:content-none prose-code:after:content-none prose-li:text-foreground prose-strong:text-foreground">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex gap-2">
                <div className="h-6 w-6 rounded-md grid place-items-center bg-ai/15 border border-ai/30">
                  <Sparkles className="h-3 w-3 text-ai animate-pulse" />
                </div>
                <div className="px-3 py-2 rounded-xl bg-card border border-border">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <span key={d} className="h-1.5 w-1.5 rounded-full bg-ai animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Suggested prompts */}
          {messages.length <= 1 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {[
                "What should I fix first?",
                "How do I upgrade the BIOS?",
                "Explain the critical violations",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-ai/50 hover:text-ai transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border bg-card/50">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Ask about remediations…"
              className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-foreground/60"
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="h-8 w-8 rounded-lg grid place-items-center bg-ai text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Remediation Step Card ───────────────────────────────────────────────────

function RemediationStepCard({
  step,
  index,
}: {
  step: NonNullable<DeviceEvaluation["remediation"]>[number];
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const riskColors: Record<string, string> = {
    CRITICAL: "text-destructive border-destructive/40 bg-destructive/5",
    WARNING: "text-warning border-warning/40 bg-warning/5",
  };
  const riskClass = step.risk ? riskColors[step.risk] ?? "text-muted-foreground" : "";

  return (
    <div className={cn(
      "glass-panel rounded-xl overflow-hidden border transition-all duration-200",
      step.risk === "CRITICAL" ? "border-destructive/30" : step.risk === "WARNING" ? "border-warning/30" : "border-border",
    )}>
      {/* Header row */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-start gap-4 p-5 text-left hover:bg-surface-2/40 transition-colors"
      >
        {/* Step number */}
        <div className={cn(
          "flex-shrink-0 h-9 w-9 rounded-lg grid place-items-center font-mono text-sm font-bold",
          step.risk === "CRITICAL" ? "bg-destructive/15 text-destructive" :
          step.risk === "WARNING" ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary",
        )}>
          {index}
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-semibold text-[14px] truncate">{step.action}</div>
          {step.component && (
            <div className="font-mono text-[11px] text-primary">
              Component: <span className="text-foreground/80">{step.component}</span>
              {step.target_version && (
                <span className="ml-2 px-1.5 py-0.5 rounded border border-primary/30 text-[10px]">
                  → v{step.target_version}
                </span>
              )}
            </div>
          )}
          {step.reason && (
            <div className="text-[12px] text-muted-foreground leading-snug line-clamp-2">{step.reason}</div>
          )}
          <div className="flex items-center gap-3 mt-1">
            {step.estimated_time && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" /> {step.estimated_time}
              </span>
            )}
            {step.risk && (
              <span className={cn("font-mono text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider", riskClass)}>
                {step.risk}
              </span>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              {(step.sub_steps?.length ?? 0)} sub-steps
            </span>
          </div>
        </div>

        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 mt-1 transition-transform", expanded && "rotate-180")} />
      </button>

      {/* Sub-steps */}
      {expanded && (step.sub_steps?.length ?? 0) > 0 && (
        <div className="border-t border-border bg-surface-2/20 divide-y divide-border/50">
          {step.sub_steps!.map((sub) => (
            <SubStepRow key={sub.order} sub={sub} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubStepRow({ sub }: { sub: RemediationSubStep }) {
  const [cmdCopied, setCmdCopied] = useState(false);

  const copyCmd = () => {
    if (!sub.command) return;
    navigator.clipboard.writeText(sub.command);
    setCmdCopied(true);
    setTimeout(() => setCmdCopied(false), 1500);
  };

  return (
    <div className="px-5 py-3 space-y-2">
      <div className="flex items-start gap-3">
        <span className="font-mono text-[10px] text-primary mt-0.5 w-5 shrink-0">{sub.order}.</span>
        <div className="flex-1 space-y-2">
          <div className="text-[13px] leading-snug">{sub.description}</div>

          {sub.command && (
            <div className="rounded-md bg-[#0d1117] border border-border/60 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40">
                <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                  <Terminal className="h-3 w-3" /> command
                </div>
                <button
                  onClick={copyCmd}
                  className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {cmdCopied ? "copied!" : "copy"}
                </button>
              </div>
              <pre className="px-3 py-2 font-mono text-[11px] text-green-400 overflow-auto whitespace-pre-wrap break-all">
                {sub.command}
              </pre>
            </div>
          )}

          {sub.warning && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warning/8 border border-warning/25">
              <TriangleAlert className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
              <span className="text-[12px] text-warning/90">{sub.warning}</span>
            </div>
          )}

          {sub.note && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-primary/5 border border-primary/20">
              <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              <span className="text-[12px] text-muted-foreground">{sub.note}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Impact Viewer ───────────────────────────────────────────────────────────

interface AffectedComponent {
  id?: string;
  name?: string;
  type?: string;
  direction?: "DEPENDS_ON_THIS" | "REQUIRED_BY_THIS" | string;
  relationship?: string;
}

interface ImpactResult {
  component: string;
  count: number;
  center?: string;
  center_found?: boolean;
  affected_components: AffectedComponent[];
}

function ImpactView({ data, loading, onRefresh }: { data: ImpactResult | null; loading: boolean; onRefresh: () => void }) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!data) return null;

  const upstream = data.affected_components.filter((c) => c.direction === "DEPENDS_ON_THIS");
  const downstream = data.affected_components.filter((c) => c.direction === "REQUIRED_BY_THIS");
  const undirected = data.affected_components.filter((c) => !c.direction);

  const renderGroup = (label: string, icon: React.ReactNode, items: AffectedComponent[], color: string) => (
    items.length > 0 && (
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface-2/40`}>
          {icon}
          <span className={`font-mono text-[10px] uppercase tracking-wider font-semibold ${color}`}>{label}</span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{items.length} component{items.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="grid grid-cols-12 px-4 py-2 border-b border-border/50 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-5">Component</div>
          <div className="col-span-4">Type</div>
          <div className="col-span-3 text-right">Relationship</div>
        </div>
        <div className="divide-y divide-border">
          {items.map((c, i) => (
            <div key={i} className="grid grid-cols-12 items-center px-4 py-3 hover:bg-surface-2/30 transition-colors">
              <div className="col-span-5 flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-[13px] truncate">{c.name ?? c.id ?? `Item ${i}`}</span>
              </div>
              <div className="col-span-4 font-mono text-[11px] text-muted-foreground uppercase">{c.type ?? "—"}</div>
              <div className="col-span-3 text-right font-mono text-[10px] text-muted-foreground truncate">{c.relationship ?? "—"}</div>
            </div>
          ))}
        </div>
      </div>
    )
  );

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="glass-panel rounded-xl p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Impact Analysis for</div>
          <div className="font-semibold text-lg">{data.center ?? data.component}</div>
          <div className="font-mono text-[12px] text-muted-foreground mt-1">
            {data.count === 0
              ? "No connected components found in the compliance graph."
              : `${data.count} connected component${data.count !== 1 ? "s" : ""} found · ${upstream.length} upstream · ${downstream.length} downstream`}
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-border text-[12px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {data.count === 0 ? (
        <div className="glass-panel rounded-xl p-10 text-center space-y-2">
          <Server className="h-8 w-8 text-muted-foreground mx-auto" />
          <div className="text-sm text-muted-foreground">
            No upstream or downstream dependencies found for <strong>{data.component}</strong> in the compliance graph.
          </div>
          <div className="text-[12px] text-muted-foreground/60">
            This is normal if no rules referencing this component have been ingested yet.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {renderGroup(
            "Upstream — Depends on this component",
            <ArrowLeft className="h-3.5 w-3.5 text-warning" />,
            upstream,
            "text-warning",
          )}
          {renderGroup(
            "Downstream — Required by this component",
            <ChevronDown className="h-3.5 w-3.5 text-primary rotate-[-90deg]" />,
            downstream,
            "text-primary",
          )}
          {renderGroup(
            "Other connected components",
            <Cpu className="h-3.5 w-3.5 text-muted-foreground" />,
            undirected,
            "text-muted-foreground",
          )}
        </div>
      )}
    </div>
  );
}

// ─── Specs Table ─────────────────────────────────────────────────────────────

function SpecsTable({ specs, loading }: { specs: DeviceSpec[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (specs.length === 0)
    return (
      <div className="glass-panel rounded-xl p-8 text-center space-y-3">
        <Server className="h-8 w-8 text-muted-foreground mx-auto" />
        <div className="text-sm font-medium text-muted-foreground">No device specifications detected</div>
        <div className="text-[12px] text-muted-foreground/70 max-w-sm mx-auto">
          Specs are auto-extracted from the inventory file you upload during evaluation.
          Run an evaluation from the <strong>Home</strong> page with an inventory file, or add specs manually below.
        </div>
      </div>
    );

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <div className="grid grid-cols-12 px-4 py-2.5 border-b border-border bg-surface-2/40 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <div className="col-span-5">Component</div>
        <div className="col-span-4">Version</div>
        <div className="col-span-3 text-right">Source</div>
      </div>
      <div className="divide-y divide-border">
        {specs.map((s, i) => {
          const isManual = s.source === "manual";
          return (
            <div key={i} className="grid grid-cols-12 items-center px-4 py-3 hover:bg-surface-2/30 transition-colors">
              <div className="col-span-5 flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-[13px]">{s.component}</span>
              </div>
              <div className="col-span-4 font-mono text-[12px] text-foreground/90">{s.version}</div>
              <div className="col-span-3 flex items-center justify-end gap-2">
                {s.confidence != null && !isManual && (
                  <span className="font-mono text-[10px] text-muted-foreground">{Math.round((s.confidence ?? 0) * 100)}%</span>
                )}
                <span className={cn(
                  "px-1.5 py-0.5 rounded-sm border font-mono text-[10px] uppercase tracking-wider",
                  isManual ? "border-info/40 text-info bg-info/5" : "border-ai/40 text-ai bg-ai/5",
                )}>
                  {isManual ? "Manual" : "Auto"}
                </span>
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function DeviceDrilldown() {
  const { deviceId } = useParams();
  const [device, setDevice] = useState<DeviceEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [manualSpecs, setManualSpecs] = useState<DeviceSpec[]>([]);
  const [scriptFormat, setScriptFormat] = useState<"powershell" | "bash">("powershell");
  const [scriptOpen, setScriptOpen] = useState(false);

  const load = async () => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.evaluateInventory();
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

  const [impactComponent, setImpactComponent] = useState<string | null>(null);

  // Collect all unique component names from specs, violations, and remediation
  const deviceComponents = useMemo(() => {
    const names = new Set<string>();
    // from specs
    (device?.specs ?? []).forEach((s) => s.component && names.add(s.component));
    (manualSpecs ?? []).forEach((s) => s.component && names.add(s.component));
    // from violations
    (device?.violations ?? []).forEach((v) =>
      (v.components ?? []).forEach((c) => c && names.add(c))
    );
    // from remediation
    (device?.remediation ?? []).forEach((r) => r.component && names.add(r.component));
    return Array.from(names).sort();
  }, [device, manualSpecs]);

  const loadImpact = async (compName?: string) => {
    const target = compName ?? impactComponent;
    if (!target) return;
    setImpactComponent(target);
    setImpactLoading(true);
    setImpact(null);
    try {
      // Query Neo4j by component name — NOT device_id
      const res = await api.impact({ component: target }) as ImpactResult;
      setImpact(res);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setImpactLoading(false);
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

  const allSpecs = [...(device?.specs ?? []), ...manualSpecs];
  const remediationSteps = device?.remediation ?? [];

  // ── PDF Export — opens a fresh window with self-contained HTML ───────────
  const exportPDF = () => {
    if (!device) return;
    const violations = device.violations ?? [];
    const steps = device.remediation ?? [];

    const violationRows = violations.length === 0
      ? '<p style="color:#16a34a">✓ No violations — device is fully compliant.</p>'
      : violations.map((v) => {
          const sev = (v.severity ?? "").toLowerCase();
          const sevColor = sev === "critical" ? "#dc2626" : sev === "warning" ? "#ca8a04" : "#3b82f6";
          const sevBg = sev === "critical" ? "#fee2e2" : sev === "warning" ? "#fef9c3" : "#dbeafe";
          return `<div style="border:1px solid #e2e8f0;border-left:4px solid ${sevColor};border-radius:4pt;padding:8pt 10pt;margin-bottom:6pt;">
            <span style="display:inline-block;background:${sevBg};color:${sevColor};font-size:7pt;font-weight:700;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;padding:1pt 5pt;border-radius:2pt;margin-right:6pt;">${v.severity}</span>
            ${v.rule_id ? `<span style="font-family:monospace;font-size:8pt;color:#64748b">${v.rule_id}</span>` : ""}
            <div style="font-size:10pt;font-weight:600;margin:3pt 0 2pt">${v.message}</div>
            ${v.explanation ? `<div style="font-size:9pt;color:#475569">${v.explanation}</div>` : ""}
          </div>`;
        }).join("");

    const stepRows = steps.length === 0
      ? '<p style="color:#64748b;font-size:9pt">No remediation steps available.</p>'
      : steps.map((step, i) => {
          const subRows = (step.sub_steps ?? []).map((sub) =>
            `<div style="margin:2pt 0 2pt 26pt;font-size:9pt;color:#334155">${sub.order}. ${sub.description}</div>
             ${sub.command ? `<div style="font-family:monospace;font-size:8pt;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3pt;padding:3pt 6pt;margin:2pt 0 2pt 26pt;word-break:break-all">${sub.command}</div>` : ""}
             ${sub.warning ? `<div style="margin:2pt 0 2pt 26pt;font-size:9pt;color:#ca8a04">⚠ ${sub.warning}</div>` : ""}`
          ).join("");
          return `<div style="border:1px solid #e2e8f0;border-radius:4pt;padding:8pt 10pt;margin-bottom:6pt;page-break-inside:avoid">
            <div><span style="font-family:monospace;font-weight:800;color:#4f46e5">${step.order ?? i + 1}.</span>
              <span style="font-weight:700;font-size:10pt;margin-left:6pt">${step.action}</span></div>
            ${step.reason ? `<div style="font-size:9pt;color:#475569;margin:2pt 0 2pt 18pt">${step.reason}</div>` : ""}
            ${step.estimated_time ? `<div style="font-size:8pt;color:#64748b;margin:1pt 0 4pt 18pt">Est. time: ${step.estimated_time}</div>` : ""}
            ${subRows}
          </div>`;
        }).join("");

    const scoreColor = (device.compliance_score ?? 0) >= 90 ? "#16a34a" : (device.compliance_score ?? 0) >= 70 ? "#ca8a04" : "#dc2626";

    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>Compliance Report — ${device.device_id}</title>
      <style>
        @page { margin: 18mm 14mm; size: A4 portrait; }
        body { font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 10pt; color: #0f172a; background: #fff; }
        h1 { font-size: 18pt; font-weight: 700; color: #1e1b4b; margin: 0 0 4pt; }
        .header { border-bottom: 2px solid #6366f1; padding-bottom: 12pt; margin-bottom: 16pt; display: flex; justify-content: space-between; align-items: flex-start; }
        .score { font-size: 28pt; font-weight: 800; font-family: monospace; color: ${scoreColor}; }
        .section-title { font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #4f46e5; border-bottom: 1px solid #e2e8f0; padding-bottom: 4pt; margin: 14pt 0 8pt; }
        .footer { margin-top: 20pt; border-top: 1px solid #e2e8f0; padding-top: 8pt; font-size: 7.5pt; color: #94a3b8; font-family: monospace; }
      </style>
    </head><body>
      <div class="header">
        <div><h1>${device.name ?? device.device_id}</h1>
          <div style="font-size:8pt;color:#64748b;font-family:monospace">Device ID: ${device.device_id} | Generated: ${new Date().toLocaleString()}</div>
        </div>
        <div style="text-align:right"><div class="score">${device.compliance_score ?? "—"}</div>
          <div style="font-size:8pt;color:#64748b">/ 100 compliance score</div></div>
      </div>
      <div class="section-title">Violations (${violations.length})</div>
      ${violationRows}
      <div class="section-title">Remediation Plan (${steps.length} steps)</div>
      ${stepRows}
      <div class="footer">ComplianceIQ — Auto-generated compliance report | ${new Date().toISOString()}</div>
    </body></html>`;

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) { toast.error("Pop-up blocked — allow pop-ups and try again."); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  const downloadScript = () => {
    if (!device?.device_id) return;
    api.downloadRemediationScript(device.device_id, scriptFormat);
    toast.success(`Downloading ${scriptFormat === "bash" ? "Bash (.sh)" : "PowerShell (.ps1)"} script…`);
    setScriptOpen(false);
  };

  return (
    <div className="relative min-h-[80vh] p-6 max-w-[1400px] mx-auto space-y-6 animate-in fade-in duration-700">
      
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute top-0 left-[20%] h-[400px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-[30%] right-[10%] h-[400px] w-[400px] translate-x-1/3 -translate-y-1/3 rounded-full bg-secondary/10 blur-[100px]" />

      <Link to="/" className="relative z-10 inline-flex items-center gap-1.5 text-[12px] font-mono uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors hover:-translate-x-1">
        <ArrowLeft className="h-3 w-3" /> Fleet Overview
      </Link>

      <div className="relative z-10 glass-panel rounded-2xl p-6 md:p-8 flex items-start justify-between gap-6 flex-wrap bg-card/40 backdrop-blur-xl border border-border/50 shadow-xl overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
          <Server className="h-32 w-32" />
        </div>
        <div className="space-y-2 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-mono tracking-[0.2em] text-primary uppercase mb-2 shadow-sm">
             <Server className="h-3 w-3" /> // Device Drilldown
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-foreground/50 bg-clip-text text-transparent">
            {device?.name ?? device?.device_id ?? deviceId}
          </h1>
          <div className="font-mono text-[12px] text-muted-foreground/80 font-medium bg-background/50 border border-border/50 px-2 py-0.5 rounded inline-block">ID: {device?.device_id}</div>
          {device?.last_evaluated && <div className="font-mono text-[11px] text-muted-foreground mt-4 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Last evaluated: {device.last_evaluated}</div>}
        </div>
        <div className="flex items-center gap-6 flex-wrap relative z-10">
          <div className="text-right glass-panel px-6 py-4 rounded-xl bg-background/40 border border-border/50 shadow-inner">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Health Score</div>
            <div className={cn("font-mono text-6xl font-black tabular-nums tracking-tighter drop-shadow-sm", scoreColor(device?.compliance_score))}>
              {device?.compliance_score ?? "—"}
              <span className="text-2xl text-muted-foreground/50 font-bold tracking-normal ml-1">/100</span>
            </div>
          </div>
          <button onClick={load} className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-primary text-primary-foreground text-[14px] font-semibold hover:bg-primary/90 transition-all glow-primary shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Re-evaluate Score
          </button>
        </div>
      </div>

      {error && (
        <div className="glass-panel rounded-xl p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <div className="text-sm text-destructive">{error}</div>
        </div>
      )}

      <Tabs defaultValue="violations" className="w-full">
        <TabsList className="bg-card/50 border border-border">
          <TabsTrigger value="violations" className="font-mono text-[11px] uppercase tracking-wider">Violations</TabsTrigger>
          <TabsTrigger value="remediation" className="font-mono text-[11px] uppercase tracking-wider">
            Remediation
            {remediationSteps.length > 0 && (
              <span className="ml-1.5 h-4 min-w-4 px-1 rounded-full bg-primary/20 text-primary font-mono text-[9px] grid place-items-center">
                {remediationSteps.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="specs" className="font-mono text-[11px] uppercase tracking-wider">Specs</TabsTrigger>
          <TabsTrigger value="impact" className="font-mono text-[11px] uppercase tracking-wider">Impact</TabsTrigger>
        </TabsList>

        {/* ── Violations ── */}
        <TabsContent value="violations" className="mt-4 space-y-2">
          {loading ? <Skeleton className="h-32 w-full" />
            : (device?.violations ?? []).length === 0 ? (
              <div className="glass-panel rounded-2xl p-10 text-center text-success border border-success/20 bg-success/5 shadow-inner">
                <div className="h-16 w-16 mx-auto bg-success/10 rounded-full flex items-center justify-center mb-4">
                  <Sparkles className="h-8 w-8 text-success" />
                </div>
                <div className="text-xl font-bold">✓ Zero Violations Detected</div>
                <div className="text-muted-foreground mt-2">This device is fully compliant with all ingested policies.</div>
              </div>
            ) : (
              <div className="grid gap-4">
                {(device?.violations ?? []).map((v, i) => (
                  <div key={i} className="relative overflow-hidden glass-panel rounded-2xl p-6 border border-border/60 shadow-md hover:shadow-lg transition-shadow">
                    <div className={cn("absolute left-0 top-0 bottom-0 w-1.5", 
                      v.severity === "CRITICAL" ? "bg-destructive" : 
                      v.severity === "WARNING" ? "bg-warning" : "bg-primary"
                    )} />
                    <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <SeverityBadge severity={String(v.severity)} />
                        {v.rule_id && <span className="font-mono text-[12px] font-bold text-foreground/80 bg-background/50 px-2 py-0.5 rounded border border-border/50">{v.rule_id}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {v.components && v.components.map((c) => (
                          <span key={c} className="font-mono text-[10px] uppercase font-bold px-2 py-1 rounded bg-card/60 border border-border text-foreground/70 flex items-center gap-1"><Cpu className="h-3 w-3" /> {c}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-base font-medium text-foreground mb-4 leading-snug">{v.message}</div>
                    {v.explanation && (
                      <div className="flex gap-3 p-4 rounded-xl border border-ai/20 bg-gradient-to-r from-ai/10 to-transparent">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-ai/20 grid place-items-center">
                          <Sparkles className="h-4 w-4 text-ai" />
                        </div>
                        <div>
                          <div className="font-mono text-[10px] uppercase font-bold tracking-widest text-ai mb-1">AI Remediation Hint</div>
                          <div className="text-[13px] text-foreground/90 leading-relaxed">{v.explanation}</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
        </TabsContent>

        {/* ── Remediation ── */}
        <TabsContent value="remediation" className="mt-4">
          {loading ? <Skeleton className="h-48 w-full" />
            : remediationSteps.length === 0 ? (
              <div className="glass-panel rounded-xl p-8 text-center text-muted-foreground">No remediation plan available.</div>
            ) : (
              <div className="space-y-4">

                {/* ── Export card (F8 + F5) ── */}
                <div className="glass-panel rounded-xl p-5 border border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Export Remediation</div>
                      <div className="text-[13px] font-medium">
                        {remediationSteps.length} step{remediationSteps.length !== 1 ? "s" : ""} ready to export
                      </div>
                    </div>
                    <Download className="h-5 w-5 text-primary/60" />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {/* PowerShell */}
                    <button
                      onClick={() => { setScriptFormat("powershell"); downloadScript(); }}
                      className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-4 hover:border-primary/50 hover:bg-primary/5 transition-all group"
                    >
                      <span className="text-2xl">⚡</span>
                      <div className="text-center">
                        <div className="text-[13px] font-semibold group-hover:text-primary transition-colors">PowerShell</div>
                        <div className="font-mono text-[10px] text-muted-foreground">.ps1</div>
                      </div>
                    </button>

                    {/* Bash */}
                    <button
                      onClick={() => { setScriptFormat("bash"); downloadScript(); }}
                      className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-4 hover:border-primary/50 hover:bg-primary/5 transition-all group"
                    >
                      <span className="text-2xl">🐧</span>
                      <div className="text-center">
                        <div className="text-[13px] font-semibold group-hover:text-primary transition-colors">Bash</div>
                        <div className="font-mono text-[10px] text-muted-foreground">.sh</div>
                      </div>
                    </button>

                    {/* PDF */}
                    <button
                      onClick={exportPDF}
                      className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-4 hover:border-destructive/50 hover:bg-destructive/5 transition-all group"
                    >
                      <FileText className="h-7 w-7 text-muted-foreground group-hover:text-destructive transition-colors" />
                      <div className="text-center">
                        <div className="text-[13px] font-semibold group-hover:text-destructive transition-colors">PDF Report</div>
                        <div className="font-mono text-[10px] text-muted-foreground">.pdf</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* ── Divider ── */}
                <div className="flex items-center gap-3 px-1">
                  <div className="h-px flex-1 bg-border" />
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {remediationSteps.length} action{remediationSteps.length !== 1 ? "s" : ""} · click any step to expand
                  </div>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {remediationSteps.map((s, i) => (
                  <RemediationStepCard key={i} step={s} index={s.order ?? i + 1} />
                ))}
              </div>
            )}
        </TabsContent>

        {/* ── Specs ── */}
        <TabsContent value="specs" className="mt-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <ManualSpecForm onAdd={handleAddSpec} />
            <label className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-border hover:border-primary/40 cursor-pointer text-[12px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground">
              <Upload className="h-3.5 w-3.5" />
              Upload Inventory JSON
              <input type="file" accept=".json,application/json" className="hidden" onChange={handleInventoryUpload} />
            </label>
          </div>
          <SpecsTable specs={allSpecs} loading={loading} />
        </TabsContent>

        {/* ── Impact ── */}
        <TabsContent value="impact" className="mt-4 space-y-4">
          {/* Component picker */}
          <div className="glass-panel rounded-xl p-5 space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Select a component to analyse its graph dependencies
            </div>
            {deviceComponents.length === 0 ? (
              <div className="text-[13px] text-muted-foreground">
                No components detected on this device yet.
                Run an evaluation with an inventory file first, or add specs manually on the Specs tab.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {deviceComponents.map((comp) => (
                  <button
                    key={comp}
                    onClick={() => loadImpact(comp)}
                    className={cn(
                      "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12px] font-mono transition-all",
                      impactComponent === comp
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    <Cpu className="h-3 w-3" />
                    {comp}
                  </button>
                ))}
              </div>
            )}
            {impactComponent && (
              <div className="flex items-center gap-2 pt-1">
                <span className="font-mono text-[11px] text-muted-foreground">
                  Analysing: <span className="text-primary">{impactComponent}</span>
                </span>
                <button
                  onClick={() => loadImpact(impactComponent)}
                  disabled={impactLoading}
                  className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-[11px] font-mono text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3 w-3", impactLoading && "animate-spin")} /> Refresh
                </button>
              </div>
            )}
          </div>

          {/* Results */}
          {impactLoading && <Skeleton className="h-40 w-full" />}
          {!impactLoading && impact && (
            <ImpactView data={impact} loading={false} onRefresh={() => loadImpact(impactComponent ?? undefined)} />
          )}
          {!impactLoading && !impact && !impactComponent && (
            <div className="glass-panel rounded-xl p-8 text-center space-y-2 text-muted-foreground text-sm">
              Select a component above to view its dependency impact in the compliance graph.
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Floating Chatbot */}
      <RemediationChatbot device={device} />
    </div>
  );
}