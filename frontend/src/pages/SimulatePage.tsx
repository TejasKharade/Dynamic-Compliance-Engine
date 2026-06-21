import { useRef, useState } from "react";
import {
  Zap, AlertTriangle, CheckCircle2, Info, ArrowRight,
  Loader2, Search, ShieldAlert, ShieldCheck, ShieldQuestion,
  ChevronDown, ChevronUp, RefreshCw, GitBranch,
} from "lucide-react";
import { api, ApiError, SimulateResult, SimulateAffectedDevice, SimulateRule } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_STYLES = {
  HIGH:   { bg: "bg-destructive/10", border: "border-destructive/50", text: "text-destructive", icon: ShieldAlert,   label: "HIGH RISK"   },
  MEDIUM: { bg: "bg-warning/10",     border: "border-warning/50",     text: "text-warning",     icon: ShieldQuestion, label: "MEDIUM RISK" },
  LOW:    { bg: "bg-success/10",     border: "border-success/50",     text: "text-success",     icon: ShieldCheck,   label: "LOW RISK"    },
};

const REL_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  REQUIRES:        { color: "text-primary",     bg: "bg-primary/10 border-primary/30",         label: "REQUIRES"        },
  CONFLICTS_WITH:  { color: "text-destructive", bg: "bg-destructive/10 border-destructive/30", label: "CONFLICTS WITH"  },
  WARNS_AGAINST:   { color: "text-warning",     bg: "bg-warning/10 border-warning/30",         label: "WARNS AGAINST"   },
  COMPATIBLE_WITH: { color: "text-success",     bg: "bg-success/10 border-success/30",         label: "COMPATIBLE WITH" },
  RECOMMENDS:      { color: "text-[hsl(270,60%,65%)]", bg: "bg-[hsl(270,60%,65%)]/10 border-[hsl(270,60%,65%)]/30", label: "RECOMMENDS" },
};

function relStyle(rel: string) {
  return REL_STYLES[rel.toUpperCase()] ?? { color: "text-muted-foreground", bg: "bg-muted/10 border-muted/30", label: rel };
}

function ScoreBar({ score, small }: { score: number; small?: boolean }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 80 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className={cn("rounded-full bg-muted overflow-hidden", small ? "h-1.5 w-20" : "h-2 w-28")}>
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("font-mono tabular-nums", small ? "text-[10px]" : "text-[11px]",
        pct >= 80 ? "text-success" : pct >= 50 ? "text-warning" : "text-destructive"
      )}>{pct}</span>
    </div>
  );
}

// ─── Rule card ────────────────────────────────────────────────────────────────

function RuleCard({ rule }: { rule: SimulateRule }) {
  const s = relStyle(rule.relationship);
  return (
    <div className={cn("rounded-lg border px-3 py-2.5 space-y-1 transition-all hover:shadow-sm", s.bg)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("font-mono text-[9px] uppercase tracking-widest font-bold", s.color)}>
          {s.label}
        </span>
        {rule.min_version && (
          <span className="font-mono text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
            {rule.operator !== "ANY" ? rule.operator : ""} {rule.min_version}
          </span>
        )}
      </div>
      <div className="text-[12px] font-medium text-foreground leading-snug">
        {rule.target || rule.source || "—"}
      </div>
    </div>
  );
}

// ─── Affected device row ──────────────────────────────────────────────────────

function DeviceRow({ device, plannedId }: { device: SimulateAffectedDevice; plannedId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full grid grid-cols-12 items-center px-4 py-2.5 text-left hover:bg-card/50 transition-colors"
      >
        <div className="col-span-4 font-mono text-[12px] text-foreground truncate">{device.device_id}</div>
        <div className="col-span-3"><ScoreBar score={device.compliance_score} small /></div>
        <div className="col-span-2 flex items-center gap-1.5">
          {device.critical_findings > 0 && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-destructive">
              <AlertTriangle className="h-3 w-3" />{device.critical_findings}
            </span>
          )}
          {device.warning_findings > 0 && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-warning">
              <Info className="h-3 w-3" />{device.warning_findings}
            </span>
          )}
        </div>
        <div className="col-span-2">
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full border",
            device.is_compliant
              ? "text-success bg-success/10 border-success/30"
              : "text-destructive bg-destructive/10 border-destructive/30"
          )}>
            {device.is_compliant ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {device.is_compliant ? "COMPLIANT" : "VIOLATION"}
          </span>
        </div>
        <div className="col-span-1 flex justify-end text-muted-foreground">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>

      {open && device.relevant_findings.length > 0 && (
        <div className="px-4 pb-4 space-y-3">
          {device.relevant_findings.map((f, i) => (
            <FindingCard key={i} finding={f} index={i} plannedId={plannedId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Pure helper functions (no JSX) ──────────────────────────────────────────

/**
 * If source/target is an old version of the component being simulated
 * (e.g. "BIOS 1.6.2" when plannedId="BIOS 2.0.0"), substitute plannedId.
 */
function resolveSource(source: string, plannedId: string): string {
  if (!plannedId) return source;
  const baseName = (id: string) =>
    id.replace(/\s+\d[\d.]*$/, "").replace(/\s+\d.*$/, "").trim();
  const srcBase     = baseName(source).toLowerCase();
  const plannedBase = baseName(plannedId).toLowerCase();
  if (srcBase && plannedBase && (
    srcBase === plannedBase ||
    srcBase.startsWith(plannedBase) ||
    plannedBase.startsWith(srcBase)
  )) {
    return plannedId;
  }
  return source;
}

function buildHeadline(f: SimulateAffectedFinding, plannedId: string): string {
  const src = resolveSource(f.source, plannedId);
  const tgt = resolveSource(f.target, plannedId);
  switch (f.rule_type) {
    case "REQUIRES":        return `${src} requires a compatible version of ${tgt}`;
    case "CONFLICTS_WITH":  return `${src} directly conflicts with ${tgt}`;
    case "WARNS_AGAINST":   return `${src} warns against using ${tgt}`;
    case "COMPATIBLE_WITH": return `${src} has a compatibility concern with ${tgt}`;
    case "RECOMMENDS":      return `${src} recommends updating ${tgt}`;
    default:                return `${src} → ${tgt}`;
  }
}

function buildExplanation(f: SimulateAffectedFinding, plannedId: string): string {
  const src = resolveSource(f.source, plannedId);
  const tgt = resolveSource(f.target, plannedId);
  const rem = f.remediation;
  const simulated = src === plannedId ? src : tgt === plannedId ? tgt : src;
  const other     = simulated === src ? tgt : src;

  switch (f.rule_type) {
    case "REQUIRES":
      return rem?.target_version
        ? `This device currently has ${other} installed at a version that does not satisfy the minimum requirement imposed by ${simulated}. Upgrading to ${simulated} will require ${other} to be at least version ${rem.target_version}. Until this prerequisite is met, ${simulated} cannot operate correctly on this device.`
        : `${simulated} has a strict dependency on ${other}. The currently installed version of ${other} does not meet the requirement, which means ${simulated} may malfunction or refuse to initialise after the upgrade.`;
    case "CONFLICTS_WITH":
      return `If you upgrade to ${simulated}, it will conflict with the ${other} present on this device. These two components cannot coexist at their respective versions — running them together can cause system instability, driver failures, or unexpected behaviour. You must resolve this conflict before deploying ${simulated}.`;
    case "WARNS_AGAINST":
      return `Upgrading to ${simulated} carries a known risk with ${other} on this device. It may not cause an outright failure immediately, but this combination is likely to produce problems after subsequent patches, firmware updates, or under specific workloads. It is strongly advised to address this proactively before rolling out ${simulated}.`;
    case "COMPATIBLE_WITH":
      return `There is a partial compatibility concern between ${simulated} and ${other} on this device. Full compatibility requires a specific version or configuration state of ${other} that is not currently met. Review the configuration before deploying ${simulated}.`;
    case "RECOMMENDS":
      return `${simulated} officially recommends a specific version of ${other} for optimal performance and stability. This is not a hard blocker preventing the upgrade, but leaving it unaddressed after deploying ${simulated} may reduce reliability over time.`;
    default:
      return f.message;
  }
}

function actionReason(ruleType: string, simulated: string, other: string): string {
  switch (ruleType) {
    case "REQUIRES":
      return `${other} must meet the minimum version required by ${simulated} before the upgrade can succeed without compliance violations.`;
    case "CONFLICTS_WITH":
      return `${simulated} and the current version of ${other} cannot coexist. Removing or replacing ${other} eliminates the active conflict and allows ${simulated} to be deployed safely.`;
    case "WARNS_AGAINST":
      return `While not a hard blocker today, keeping this version of ${other} alongside ${simulated} introduces a known instability risk. Replacing it now prevents future problems.`;
    case "COMPATIBLE_WITH":
      return `Reaching the required version of ${other} ensures full compatibility with ${simulated} and removes the partial compatibility flag.`;
    case "RECOMMENDS":
      return `${simulated} performs best when paired with the recommended version of ${other}. This update improves stability and long-term support alignment.`;
    default:
      return `Resolving this finding is necessary to bring the device into compliance with the rules that govern ${simulated}.`;
  }
}

/**
 * Extracts currently installed version from the raw backend message:
 *   "...but the installed value is 7.0"
 *   "...Machine value: 1.2.0"
 */
function parseInstalledVersion(message: string): string | null {
  const patterns = [
    /installed value is ([\d.]+[\w.-]*)/i,
    /Machine value:\s*([\d.]+[\w.-]*)/i,
    /currently at ([\d.]+[\w.-]*)/i,
    /installed:\s*([\d.]+[\w.-]*)/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

// ─── Local type alias (avoids inline import() in JSX signatures) ───────────
type SimulateAffectedFinding = import("@/lib/api").SimulateAffectedFinding;

// ─── Rich finding explanation card ───────────────────────────────────────────

function FindingCard({ finding: f, index, plannedId }: {
  finding: SimulateAffectedFinding;
  index: number;
  plannedId: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const severityStyles = {
    CRITICAL: {
      wrap:   "bg-destructive/5 border-destructive/25",
      badge:  "text-destructive bg-destructive/10 border-destructive/30",
      accent: "border-l-destructive",
      icon:   <AlertTriangle className="h-3.5 w-3.5 text-destructive" />,
    },
    WARNING: {
      wrap:   "bg-warning/5 border-warning/25",
      badge:  "text-warning bg-warning/10 border-warning/30",
      accent: "border-l-warning",
      icon:   <Info className="h-3.5 w-3.5 text-warning" />,
    },
  }[f.severity] ?? {
    wrap:   "bg-muted/20 border-border",
    badge:  "text-muted-foreground bg-muted border-border",
    accent: "border-l-muted-foreground",
    icon:   <Info className="h-3.5 w-3.5 text-muted-foreground" />,
  };

  const ruleStyles    = relStyle(f.rule_type);
  const headline      = buildHeadline(f, plannedId);
  const explanation   = buildExplanation(f, plannedId);

  const resolvedSrc   = resolveSource(f.source, plannedId);
  const resolvedTgt   = resolveSource(f.target, plannedId);
  const simulated     = resolvedSrc === plannedId ? resolvedSrc : resolvedTgt === plannedId ? resolvedTgt : resolvedSrc;
  const other         = simulated === resolvedSrc ? resolvedTgt : resolvedSrc;

  const installedVer  = parseInstalledVersion(f.message);
  const requiredVer   = f.remediation?.target_version ?? null;
  const humanReason   = f.remediation ? actionReason(f.rule_type, simulated, other) : null;

  const isRemoveAction = f.remediation?.action.includes("remove") || f.remediation?.action.includes("avoid");

  return (
    <div className={cn("rounded-lg border border-l-4 overflow-hidden transition-all", severityStyles.wrap, severityStyles.accent)}>

      {/* ── Header ── */}
      <div className="px-4 pt-3 pb-2 flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{severityStyles.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
            <span className={cn("font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border font-bold", severityStyles.badge)}>
              {f.severity}
            </span>
            <span className={cn("font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border", ruleStyles.bg, ruleStyles.color)}>
              {ruleStyles.label}
            </span>
            <span className="font-mono text-[9px] text-muted-foreground">Finding #{index + 1}</span>
          </div>
          <h4 className="text-[13px] font-semibold text-foreground leading-snug">{headline}</h4>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-4 pb-3 space-y-3">
        <p className="text-[12.5px] text-muted-foreground leading-relaxed">{explanation}</p>

        {/* Technical context toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Hide" : "Show"} technical detail
        </button>

        {expanded && (
          <div className="rounded-md bg-card/60 border border-border px-3 py-2.5 font-mono text-[11px] text-foreground/80 leading-relaxed space-y-1">
            <div><span className="text-muted-foreground">Rule:   </span>{f.rule_type}</div>
            <div><span className="text-muted-foreground">Source: </span>{f.source}</div>
            <div><span className="text-muted-foreground">Target: </span>{f.target}</div>
            <div className="pt-1 border-t border-border/60 text-[10.5px] text-muted-foreground leading-relaxed">{f.message}</div>
          </div>
        )}

        {/* ── Remediation action ── */}
        {f.remediation && (
          <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-3 space-y-2">

            <div className="flex items-center gap-2">
              <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-[11px] font-mono uppercase tracking-wider text-primary font-bold">Recommended Action</span>
            </div>

            <div className="flex items-center flex-wrap gap-2">
              <span className="text-[13px] font-semibold text-foreground">
                {f.remediation.action.charAt(0).toUpperCase() + f.remediation.action.slice(1)}
              </span>
              <span className="font-mono text-[13px] font-bold text-primary">{f.remediation.component}</span>

              {/* Version transition pill — upgrade/install */}
              {(installedVer || requiredVer) && !isRemoveAction && (
                <div className="inline-flex items-center gap-1.5 bg-card border border-border rounded-full px-2.5 py-0.5">
                  {installedVer && (
                    <span className="font-mono text-[10px] text-destructive font-semibold">{installedVer}</span>
                  )}
                  {installedVer && requiredVer && (
                    <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
                  )}
                  {requiredVer && (
                    <span className="font-mono text-[10px] text-success font-semibold">{requiredVer}</span>
                  )}
                </div>
              )}

              {/* Installed version pill — remove/replace */}
              {isRemoveAction && installedVer && (
                <div className="inline-flex items-center gap-1 bg-destructive/10 border border-destructive/20 rounded-full px-2.5 py-0.5">
                  <span className="font-mono text-[10px] text-destructive font-semibold">installed: {installedVer}</span>
                </div>
              )}
            </div>

            {humanReason && (
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">{humanReason}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Suggestion chips ────────────────────────────────────────────────────────

const EXAMPLES = [
  { component: "BIOS", version: "2.0.0" },
  { component: "Windows 11", version: "24H2" },
  { component: "Intel Chipset Driver", version: "" },
  { component: "NVIDIA Graphics Driver", version: "" },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SimulatePage() {
  const [component, setComponent] = useState("");
  const [version, setVersion]     = useState("");
  const [busy, setBusy]           = useState(false);
  const [result, setResult]       = useState<SimulateResult | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const resultRef                 = useRef<HTMLDivElement>(null);

  const run = async (comp = component, ver = version) => {
    const c = comp.trim();
    if (!c) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.simulate({ component: c, target_version: ver.trim() });
      setResult(res);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const riskStyle = result?.risk_level ? RISK_STYLES[result.risk_level] : null;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">

      {/* ── Header ── */}
      <div>
        <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase mb-1">
          What-If Analysis
        </div>
        <h1 className="text-2xl font-semibold flex items-center gap-2 text-foreground">
          <Zap className="h-6 w-6 text-primary" />
          What-If Simulator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Simulate changing a component to a new version. See every rule, blocker, and affected device — before touching anything.
        </p>
      </div>

      {/* ── Input form ── */}
      <div className="relative z-10 glass-panel rounded-2xl p-6 md:p-8 space-y-6 bg-card/40 backdrop-blur-xl border border-border/50 shadow-xl overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
          <Zap className="h-32 w-32" />
        </div>
        <div className="grid sm:grid-cols-2 gap-6 relative z-10">
          <div className="space-y-2">
            <label className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground ml-1">
              Component name
            </label>
            <input
              type="text"
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="e.g. BIOS 1.6.2 · Windows 11"
              className="w-full h-12 bg-background/50 backdrop-blur-sm border border-border/60 rounded-xl px-4 text-[14px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all shadow-inner"
            />
          </div>
          <div className="space-y-2">
            <label className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground ml-1">
              Target version <span className="normal-case text-muted-foreground/50">(optional)</span>
            </label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="e.g. 2.0.0 · 24H2"
              className="w-full h-12 bg-background/50 backdrop-blur-sm border border-border/60 rounded-xl px-4 text-[14px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all shadow-inner"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 relative z-10">
          <span className="font-mono text-[11px] text-muted-foreground/80 font-medium">Try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.component + ex.version}
              onClick={() => { setComponent(ex.component); setVersion(ex.version); run(ex.component, ex.version); }}
              className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-border/50 text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-primary transition-all bg-card/40 shadow-sm"
            >
              {ex.component}{ex.version ? <span className="opacity-60 ml-1">→ {ex.version}</span> : ""}
            </button>
          ))}
        </div>

        <button
          onClick={() => run()}
          disabled={busy || !component.trim()}
          className="relative z-10 inline-flex items-center gap-2 h-12 px-8 rounded-xl bg-primary text-primary-foreground text-[14px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-all glow-primary shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {busy ? "Running Simulation Engine…" : "Run Simulation Analysis"}
        </button>
      </div>

      {/* ── Empty State / Feature Showcase ── */}
      {!result && !busy && !error && (
        <div className="relative z-10 grid md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700 mt-8">
          <div className="glass-panel rounded-2xl p-6 border border-border/50 bg-card/20 backdrop-blur-sm hover:bg-card/40 transition-colors group">
            <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <ShieldAlert className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-bold text-foreground mb-2">Proactive Risk Detection</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Discover conflicts and blockers before they reach production. The engine cross-references the entire knowledge graph instantly.
            </p>
          </div>
          <div className="glass-panel rounded-2xl p-6 border border-border/50 bg-card/20 backdrop-blur-sm hover:bg-card/40 transition-colors group">
            <div className="h-12 w-12 rounded-xl bg-warning/10 border border-warning/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <GitBranch className="h-6 w-6 text-warning" />
            </div>
            <h3 className="text-lg font-bold text-foreground mb-2">Blast Radius Analysis</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              See exactly which devices will be affected by a component upgrade across your entire fleet in real-time.
            </p>
          </div>
          <div className="glass-panel rounded-2xl p-6 border border-border/50 bg-card/20 backdrop-blur-sm hover:bg-card/40 transition-colors group">
            <div className="h-12 w-12 rounded-xl bg-ai/10 border border-ai/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Zap className="h-6 w-6 text-ai" />
            </div>
            <h3 className="text-lg font-bold text-foreground mb-2">Actionable Intelligence</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Get immediate, context-aware remediation steps to safely execute the change without breaking dependencies.
            </p>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="relative z-10 glass-panel rounded-xl p-4 border-l-2 border-destructive flex items-start gap-3 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <span className="text-sm text-destructive font-medium">{error}</span>
        </div>
      )}

      {/* ── Not found ── */}
      {result && !result.found && (
        <div className="glass-panel rounded-xl p-6 text-center space-y-2">
          <GitBranch className="h-8 w-8 text-muted-foreground mx-auto" />
          <div className="text-foreground font-medium">Component not found in knowledge graph</div>
          <div className="text-sm text-muted-foreground">{result.message}</div>
        </div>
      )}

      {/* ── Results ── */}
      {result?.found && (
        <div ref={resultRef} className="space-y-6 relative z-10 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Change summary + Risk badge */}
          <div className="flex flex-wrap gap-4 items-stretch">
            <div className="flex-1 relative overflow-hidden glass-panel rounded-2xl p-6 space-y-2 min-w-[260px] bg-card/40 backdrop-blur-xl border border-border/50 shadow-lg">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <GitBranch className="h-24 w-24" />
              </div>
              <div className="relative z-10 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Simulating change</div>
              <div className="relative z-10 flex items-center gap-3 flex-wrap">
                <span className="font-mono text-lg font-bold text-foreground">
                  {result.change_request?.component}
                </span>
                {result.change_request?.target_version && (
                  <>
                    <ArrowRight className="h-5 w-5 text-primary shrink-0 opacity-80" />
                    <span className="font-mono text-lg font-extrabold text-primary bg-primary/10 px-3 py-0.5 rounded-lg border border-primary/20 shadow-sm">
                      {result.change_request.target_version}
                    </span>
                  </>
                )}
              </div>
              <div className="relative z-10 font-mono text-[11px] text-muted-foreground mt-2">
                Graph node matched: <span className="text-foreground font-medium bg-card px-1.5 py-0.5 rounded border border-border/50">{result.change_request?.graph_node_used}</span>
                {result.graph_context?.component_type && (
                  <> · type: <span className="text-foreground font-medium uppercase">{result.graph_context.component_type}</span></>
                )}
              </div>
            </div>

            {riskStyle && (() => {
              const Icon = riskStyle.icon;
              return (
                <div className={cn(
                  "relative overflow-hidden glass-panel rounded-2xl p-6 flex items-center gap-4 border-2 min-w-[220px] shadow-lg",
                  riskStyle.bg, riskStyle.border
                )}>
                  <div className={cn("absolute -right-6 -bottom-6 h-32 w-32 rounded-full blur-3xl opacity-20", `bg-${riskStyle.text.split("-")[1]}`)} />
                  <Icon className={cn("h-10 w-10 relative z-10", riskStyle.text)} />
                  <div className="relative z-10">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Deployment Risk</div>
                    <div className={cn("text-2xl font-black font-mono tracking-tighter", riskStyle.text)}>
                      {riskStyle.label}
                    </div>
                  </div>
                </div>
              );
            })()}

            {result.impact_summary && (
              <div className="flex gap-4 flex-wrap">
                {[
                  { label: "Affected Devices", val: result.impact_summary.devices_with_related_findings, color: "text-foreground", bg: "bg-card/40" },
                  { label: "Critical Risk",    val: result.impact_summary.critical_devices,              color: "text-destructive", bg: "bg-destructive/5" },
                  { label: "Warnings",         val: result.impact_summary.warning_devices,               color: "text-warning", bg: "bg-warning/5" },
                ].map((s) => (
                  <div key={s.label} className={cn("relative overflow-hidden glass-panel rounded-2xl p-5 text-center min-w-[120px] shadow-lg border border-border/50 backdrop-blur-md flex flex-col justify-center", s.bg)}>
                    <div className={cn("text-4xl font-extrabold font-mono tracking-tighter relative z-10", s.color)}>{s.val}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-2 font-semibold relative z-10">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Graph rules: 3 columns */}
          {result.graph_context && (
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="font-mono text-[11px] uppercase tracking-wider text-destructive font-bold">Blockers</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">{result.graph_context.blockers.length}</span>
                </div>
                {result.graph_context.blockers.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-success/30 px-3 py-4 text-center">
                    <CheckCircle2 className="h-5 w-5 text-success mx-auto mb-1" />
                    <p className="text-[11px] text-success font-mono">No blockers</p>
                  </div>
                ) : result.graph_context.blockers.map((r, i) => <RuleCard key={i} rule={r} />)}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-primary" />
                  <span className="font-mono text-[11px] uppercase tracking-wider text-primary font-bold">Requirements</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">{result.graph_context.direct_requirements.length}</span>
                </div>
                {result.graph_context.direct_requirements.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
                    <p className="text-[11px] text-muted-foreground font-mono">No additional requirements</p>
                  </div>
                ) : result.graph_context.direct_requirements.map((r, i) => <RuleCard key={i} rule={r} />)}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-[hsl(270,60%,65%)]" />
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[hsl(270,60%,65%)] font-bold">Advisories</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">{result.graph_context.advisories.length}</span>
                </div>
                {result.graph_context.advisories.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
                    <p className="text-[11px] text-muted-foreground font-mono">No advisories</p>
                  </div>
                ) : result.graph_context.advisories.map((r, i) => <RuleCard key={i} rule={r} />)}
              </div>
            </div>
          )}

          {/* Recommended next actions */}
          {result.recommended_next_actions && result.recommended_next_actions.length > 0 && (
            <div className="glass-panel rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" />
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Recommended Actions</span>
              </div>
              <ol className="space-y-2">
                {result.recommended_next_actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-3 text-[13px] text-foreground">
                    <span className="font-mono text-[10px] text-primary bg-primary/10 border border-primary/30 rounded-full h-5 w-5 flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{action}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Affected devices table */}
          {result.affected_devices && result.affected_devices.length > 0 && (
            <div className="glass-panel rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Affected Devices</div>
                  <div className="text-sm text-foreground font-medium mt-0.5">
                    {result.affected_devices.length} device{result.affected_devices.length !== 1 ? "s" : ""} with related findings
                  </div>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">Click a row to expand findings</span>
              </div>

              <div className="grid grid-cols-12 px-4 py-2 border-b border-border bg-card/30 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <div className="col-span-4">Device ID</div>
                <div className="col-span-3">Score</div>
                <div className="col-span-2">Findings</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-1" />
              </div>

              <div className="divide-y divide-border max-h-[480px] overflow-auto scrollbar-thin">
                {result.affected_devices.map((device) => (
                  <DeviceRow
                    key={device.device_id}
                    device={device}
                    plannedId={result.change_request?.planned_component_id ?? ""}
                  />
                ))}
              </div>
            </div>
          )}

          {result.affected_devices?.length === 0 && (
            <div className="glass-panel rounded-xl p-6 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-success mx-auto" />
              <div className="text-foreground font-medium">No affected devices found in cache</div>
              <div className="text-sm text-muted-foreground">
                Run an evaluation first to populate the device cache, then re-simulate.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
