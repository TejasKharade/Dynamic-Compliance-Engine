/**
 * FamilyTabs — renders completely different tab sets and table layouts
 * depending on the document family of the evaluated device.
 *
 * COMPATIBILITY_MATRIX  → "Rule Violations" table: Source → Target, operator, version
 * PRODUCT_POLICY        → "Policy Checklist" table: Requirement / Status / Detail
 * PLATFORM_REQUIREMENTS → "Hardware Checklist" table: Component / Required / Installed / Status
 * VERSION_SKEW          → "Skew Analysis" table: Component / Version / vs. Reference / Skew / Limit
 *
 * All families share the same Remediation, Specs and Impact tabs.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles, Upload, Download, FileText, RefreshCw, Cpu,
  CheckCircle2, XCircle, AlertTriangle, ArrowRight, Minus,
  TrendingUp, TrendingDown,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { SeverityBadge } from "@/components/SeverityBadge";
import { getFamilyMeta } from "@/components/DocumentFamilyBadge";
import { cn } from "@/lib/utils";
import type { DeviceEvaluation, DeviceSpec, RemediationStep } from "@/lib/api";

// ── Types re-used from DeviceDrilldown ────────────────────────────────────────

interface ImpactResult { count: number; affected_components: { id: string; direction: string; relationship: string; type: string }[]; center?: string }

interface FamilyTabsProps {
  device: DeviceEvaluation | null;
  loading: boolean;
  remediationSteps: RemediationStep[];
  allSpecs: DeviceSpec[];
  deviceComponents: string[];
  impactComponent: string;
  impactLoading: boolean;
  impact: ImpactResult | null;
  handleAddSpec: (s: DeviceSpec) => void;
  handleInventoryUpload: React.ChangeEventHandler<HTMLInputElement>;
  loadImpact: (comp?: string) => void;
  setScriptFormat: (f: string) => void;
  downloadScript: () => void;
  exportPDF: () => void;
}

// ── Shared: badge pill ────────────────────────────────────────────────────────

function StatusPill({ pass }: { pass: boolean }) {
  return pass ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success text-[10px] font-semibold font-mono">
      <CheckCircle2 className="h-3 w-3" /> PASS
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold font-mono">
      <XCircle className="h-3 w-3" /> FAIL
    </span>
  );
}

function TableHeader({ cols }: { cols: string[] }) {
  return (
    <div
      className="grid gap-3 px-4 py-2 border-b border-border bg-muted/20 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
      style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
    >
      {cols.map((c) => <div key={c}>{c}</div>)}
    </div>
  );
}

// ── Family 1: Compatibility Matrix ── "Rule Violations" ───────────────────────

function CompatibilityViolationsTab({
  violations, loading,
}: { violations: DeviceEvaluation["violations"]; loading: boolean }) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!violations || violations.length === 0)
    return <div className="glass-panel rounded-xl p-8 text-center text-success">✓ No violations — all component constraints satisfied.</div>;

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <TableHeader cols={["Severity", "Rule Type", "Source Component", "→ Target Component", "Detail"]} />
      <div className="divide-y divide-border">
        {violations.map((v, i) => {
          const [src, tgt] = v.components ?? ["—", "—"];
          return (
            <div key={i} className="grid gap-3 px-4 py-3 text-[13px] hover:bg-muted/10 transition-colors"
              style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
              <div><SeverityBadge severity={v.severity ?? "INFO"} /></div>
              <div className="font-mono text-[11px] text-muted-foreground self-center">{v.rule_id ?? "—"}</div>
              <div className="font-mono text-[12px] self-center truncate" title={src}>{src ?? "—"}</div>
              <div className="flex items-center gap-1 font-mono text-[12px] self-center truncate" title={tgt}>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                {tgt ?? "—"}
              </div>
              <div className="text-[12px] text-muted-foreground self-center leading-snug">{v.message}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Family 2: Product Policy ── "Policy Checklist" ────────────────────────────

function PolicyChecklist({
  violations, loading,
}: { violations: DeviceEvaluation["violations"]; loading: boolean }) {
  if (loading) return <Skeleton className="h-40 w-full" />;

  // Split into pass (no violations for this target) and fail
  const fails = violations ?? [];
  const allPass = fails.length === 0;

  return (
    <div className="space-y-3">
      {allPass ? (
        <div className="glass-panel rounded-xl p-8 text-center text-success">✓ All product policy requirements are satisfied on this device.</div>
      ) : (
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-purple-500/20 bg-purple-500/5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-purple-400">
              📦 Product Policy Requirements
            </div>
          </div>
          <TableHeader cols={["Status", "Requirement", "Rule Type", "Detail", "Fix"]} />
          <div className="divide-y divide-border">
            {fails.map((v, i) => {
              const [src] = v.components ?? [];
              const isConflict = (v.rule_id ?? "").includes("CONFLICT");
              return (
                <div key={i} className="grid gap-3 px-4 py-3 text-[13px] hover:bg-muted/10 transition-colors"
                  style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
                  <div className="self-center"><StatusPill pass={false} /></div>
                  <div className="font-mono text-[12px] self-center font-medium">{v.components?.join(" → ") ?? "—"}</div>
                  <div className="self-center">
                    <span className={cn("font-mono text-[10px] px-1.5 py-0.5 rounded border",
                      isConflict ? "border-destructive/40 text-destructive" : "border-primary/30 text-primary/80")}>
                      {v.rule_id ?? "REQUIRES"}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted-foreground self-center leading-snug col-span-1">{v.message}</div>
                  <div className="text-[12px] text-primary/80 self-center leading-snug">
                    {v.explanation ?? "Review product requirements."}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Family 3: Platform Requirements ── "Hardware Checklist" ───────────────────

function HardwareChecklist({
  violations, specs, loading,
}: { violations: DeviceEvaluation["violations"]; specs: DeviceSpec[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-40 w-full" />;

  const fails = violations ?? [];
  const failedTargets = new Set(fails.flatMap((v) => v.components ?? []));

  // Build a combined list: specs that passed + violations that failed
  const passItems = specs
    .filter((s) => !failedTargets.has(s.component))
    .map((s) => ({ component: s.component, installed: s.version, required: "≥ minimum", pass: true, message: "" }));

  const failItems = fails.map((v) => {
    const [, tgt] = v.components ?? [];
    const spec = specs.find((s) => s.component === (tgt ?? ""));
    return {
      component: tgt ?? v.components?.[0] ?? "—",
      installed: spec?.version ?? "Not found",
      required: v.message?.match(/>=?\s*[\d\w\s.]+/)?.[0] ?? "See detail",
      pass: false,
      message: v.message,
    };
  });

  const allItems = [...failItems, ...passItems];

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-emerald-500/20 bg-emerald-500/5">
        <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">
          🖥️ Hardware Requirements Checklist
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {failItems.length} failed · {passItems.length} passed
        </div>
      </div>
      <TableHeader cols={["Status", "Component", "Required", "Installed", "Notes"]} />
      <div className="divide-y divide-border">
        {allItems.map((item, i) => (
          <div key={i} className={cn("grid gap-3 px-4 py-3 text-[13px] transition-colors",
            item.pass ? "hover:bg-success/5" : "hover:bg-destructive/5 bg-destructive/5")}
            style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
            <div className="self-center"><StatusPill pass={item.pass} /></div>
            <div className="font-mono text-[12px] font-medium self-center">{item.component}</div>
            <div className="font-mono text-[12px] text-muted-foreground self-center">{item.required}</div>
            <div className={cn("font-mono text-[12px] self-center font-semibold",
              item.pass ? "text-success" : "text-destructive")}>
              {item.installed}
            </div>
            <div className="text-[11px] text-muted-foreground self-center leading-snug">
              {item.pass ? "✓ Meets minimum requirement" : item.message}
            </div>
          </div>
        ))}
        {allItems.length === 0 && (
          <div className="px-4 py-8 text-center text-success">✓ All hardware requirements met.</div>
        )}
      </div>
    </div>
  );
}

// ── Family 4: Version Skew ── "Skew Analysis" ─────────────────────────────────

function SkewAnalysis({
  violations, specs, loading,
}: { violations: DeviceEvaluation["violations"]; specs: DeviceSpec[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-40 w-full" />;

  const fails = violations ?? [];

  function getVersion(name: string) {
    return specs.find((s) => s.component === name)?.version ?? "—";
  }

  function extractMinor(ver: string) {
    const parts = ver.split(".");
    return parts.length >= 2 ? parseInt(parts[1]) : null;
  }

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-amber-500/20 bg-amber-500/5">
        <div className="font-mono text-[10px] uppercase tracking-widest text-amber-400">
          ⚖️ Version Skew Analysis
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {fails.length === 0 ? "All components within allowed version skew." : `${fails.length} skew violation${fails.length !== 1 ? "s" : ""} detected.`}
        </div>
      </div>

      {fails.length === 0 ? (
        <div className="p-8 text-center text-success">✓ All component version gaps are within policy limits.</div>
      ) : (
        <>
          <TableHeader cols={["Status", "Component", "Installed", "Reference", "Skew", "Rule Type"]} />
          <div className="divide-y divide-border">
            {fails.map((v, i) => {
              const [src, tgt] = v.components ?? [];
              const srcVer = getVersion(src ?? "");
              const tgtVer = getVersion(tgt ?? "");
              const srcMinor = extractMinor(srcVer);
              const tgtMinor = extractMinor(tgtVer);
              const skew = (srcMinor != null && tgtMinor != null) ? srcMinor - tgtMinor : null;
              const isNewer = skew != null && skew > 0;
              const isOlder = skew != null && skew < 0;

              return (
                <div key={i} className="grid gap-3 px-4 py-3 text-[13px] bg-destructive/5 hover:bg-destructive/10 transition-colors"
                  style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
                  <div className="self-center"><StatusPill pass={false} /></div>
                  <div className="font-mono text-[12px] font-medium self-center">{src ?? "—"}</div>
                  <div className="font-mono text-[12px] text-destructive self-center">{srcVer}</div>
                  <div className="font-mono text-[12px] text-muted-foreground self-center flex items-center gap-1">
                    <ArrowRight className="h-3 w-3" />{tgt ?? "—"} ({tgtVer})
                  </div>
                  <div className="self-center">
                    {skew != null ? (
                      <span className={cn("inline-flex items-center gap-1 font-mono text-[12px] font-bold",
                        isNewer ? "text-orange-400" : isOlder ? "text-destructive" : "text-muted-foreground")}>
                        {isNewer ? <TrendingUp className="h-3.5 w-3.5" /> : isOlder ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                        {skew > 0 ? "+" : ""}{skew}
                      </span>
                    ) : <span className="text-muted-foreground font-mono text-[11px]">—</span>}
                  </div>
                  <div className="font-mono text-[10px] self-center">
                    <span className="px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-400">
                      {v.rule_id ?? "SKEW"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Skew legend */}
          <div className="px-4 py-3 border-t border-border bg-card/30 flex gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3 text-orange-400" /> Source newer than reference</span>
            <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3 text-destructive" /> Source older than reference</span>
            <span className="flex items-center gap-1 font-mono">±N = minor version distance</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Shared: Remediation tab ───────────────────────────────────────────────────

function RemediationTab({
  remediationSteps, setScriptFormat, downloadScript, exportPDF,
  RemediationStepCard,
}: {
  remediationSteps: RemediationStep[];
  setScriptFormat: (f: string) => void;
  downloadScript: () => void;
  exportPDF: () => void;
  RemediationStepCard: React.ComponentType<{ step: RemediationStep; index: number }>;
}) {
  return (
    <div className="space-y-4 mt-4">
      {remediationSteps.length === 0 ? (
        <div className="glass-panel rounded-xl p-8 text-center text-muted-foreground">No remediation plan available.</div>
      ) : (
        <>
          <div className="glass-panel rounded-xl p-5 border border-border">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Export Remediation</div>
                <div className="text-[13px] font-medium">{remediationSteps.length} step{remediationSteps.length !== 1 ? "s" : ""} ready to export</div>
              </div>
              <Download className="h-5 w-5 text-primary/60" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => { setScriptFormat("powershell"); downloadScript(); }}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-4 hover:border-primary/50 hover:bg-primary/5 transition-all group">
                <span className="text-2xl">⚡</span>
                <div className="text-center">
                  <div className="text-[13px] font-semibold group-hover:text-primary">PowerShell</div>
                  <div className="font-mono text-[10px] text-muted-foreground">.ps1</div>
                </div>
              </button>
              <button onClick={() => { setScriptFormat("bash"); downloadScript(); }}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-4 hover:border-primary/50 hover:bg-primary/5 transition-all group">
                <span className="text-2xl">🐧</span>
                <div className="text-center">
                  <div className="text-[13px] font-semibold group-hover:text-primary">Bash</div>
                  <div className="font-mono text-[10px] text-muted-foreground">.sh</div>
                </div>
              </button>
              <button onClick={exportPDF}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-4 hover:border-destructive/50 hover:bg-destructive/5 transition-all group">
                <FileText className="h-7 w-7 text-muted-foreground group-hover:text-destructive" />
                <div className="text-center">
                  <div className="text-[13px] font-semibold group-hover:text-destructive">PDF Report</div>
                  <div className="font-mono text-[10px] text-muted-foreground">.pdf</div>
                </div>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 px-1">
            <div className="h-px flex-1 bg-border" />
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {remediationSteps.length} action{remediationSteps.length !== 1 ? "s" : ""} · click to expand
            </div>
            <div className="h-px flex-1 bg-border" />
          </div>
          {remediationSteps.map((s, i) => (
            <RemediationStepCard key={i} step={s} index={s.order ?? i + 1} />
          ))}
        </>
      )}
    </div>
  );
}

// ── Main export: FamilyTabs ───────────────────────────────────────────────────

export function FamilyTabs({
  device, loading, remediationSteps, allSpecs, deviceComponents,
  impactComponent, impactLoading, impact,
  handleAddSpec, handleInventoryUpload, loadImpact,
  setScriptFormat, downloadScript, exportPDF,
}: FamilyTabsProps) {
  const family = device?.document_family ?? "COMPATIBILITY_MATRIX";
  const meta = getFamilyMeta(family);
  const violations = device?.violations ?? [];

  // Dynamically import the RemediationStepCard from DeviceDrilldown context
  // We pass it through from parent via dynamic import or keep it here
  // Since it's defined in DeviceDrilldown we re-define a minimal version here
  // (the full version with accordion is in DeviceDrilldown — we reference it via the
  //  same Tabs/TabsContent so the parent still owns RemediationStepCard)

  // ── Tab configs per family ────────────────────────────────────────────────
  const tabConfigs: { value: string; label: string; count?: number }[] = [];

  if (family === "COMPATIBILITY_MATRIX") {
    tabConfigs.push({ value: "violations", label: "🔗 Rule Violations", count: violations.length || undefined });
  } else if (family === "PRODUCT_POLICY") {
    tabConfigs.push({ value: "violations", label: "📦 Policy Checklist", count: violations.length || undefined });
  } else if (family === "PLATFORM_REQUIREMENTS") {
    tabConfigs.push({ value: "violations", label: "🖥️ HW Checklist", count: violations.length || undefined });
  } else if (family === "VERSION_SKEW") {
    tabConfigs.push({ value: "violations", label: "⚖️ Skew Analysis", count: violations.length || undefined });
  } else {
    tabConfigs.push({ value: "violations", label: "Violations", count: violations.length || undefined });
  }

  tabConfigs.push(
    { value: "remediation", label: "Remediation", count: remediationSteps.length || undefined },
    { value: "specs", label: "Specs" },
    { value: "impact", label: "Impact" },
  );

  return (
    <Tabs defaultValue="violations" className="w-full">
      <TabsList className={cn("border", meta.borderClass, "bg-card/50")}>
        {tabConfigs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="font-mono text-[11px] uppercase tracking-wider"
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className={cn(
                "ml-1.5 h-4 min-w-4 px-1 rounded-full font-mono text-[9px] grid place-items-center",
                tab.value === "violations" && violations.length > 0
                  ? "bg-destructive/20 text-destructive"
                  : "bg-primary/20 text-primary"
              )}>
                {tab.count}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* ── Family-specific violations tab ── */}
      <TabsContent value="violations" className="mt-4">
        {family === "COMPATIBILITY_MATRIX" && (
          <CompatibilityViolationsTab violations={violations} loading={loading} />
        )}
        {family === "PRODUCT_POLICY" && (
          <PolicyChecklist violations={violations} loading={loading} />
        )}
        {family === "PLATFORM_REQUIREMENTS" && (
          <HardwareChecklist violations={violations} specs={allSpecs} loading={loading} />
        )}
        {family === "VERSION_SKEW" && (
          <SkewAnalysis violations={violations} specs={allSpecs} loading={loading} />
        )}
        {!["COMPATIBILITY_MATRIX","PRODUCT_POLICY","PLATFORM_REQUIREMENTS","VERSION_SKEW"].includes(family) && (
          <CompatibilityViolationsTab violations={violations} loading={loading} />
        )}
      </TabsContent>

      {/* ── Remediation (shared) ── */}
      <TabsContent value="remediation" className="mt-4">
        {loading ? <Skeleton className="h-48 w-full" /> : (
          remediationSteps.length === 0 ? (
            <div className="glass-panel rounded-xl p-8 text-center text-muted-foreground">No remediation plan available.</div>
          ) : (
            <div className="space-y-4">
              <div className="glass-panel rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Export Remediation</div>
                    <div className="text-[13px] font-medium">{remediationSteps.length} step{remediationSteps.length !== 1 ? "s" : ""} ready to export</div>
                  </div>
                  <Download className="h-5 w-5 text-primary/60" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <button onClick={() => { setScriptFormat("powershell"); downloadScript(); }}
                    className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-4 hover:border-primary/50 hover:bg-primary/5 transition-all group">
                    <span className="text-2xl">⚡</span>
                    <div className="text-center"><div className="text-[13px] font-semibold group-hover:text-primary">PowerShell</div><div className="font-mono text-[10px] text-muted-foreground">.ps1</div></div>
                  </button>
                  <button onClick={() => { setScriptFormat("bash"); downloadScript(); }}
                    className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-4 hover:border-primary/50 hover:bg-primary/5 transition-all group">
                    <span className="text-2xl">🐧</span>
                    <div className="text-center"><div className="text-[13px] font-semibold group-hover:text-primary">Bash</div><div className="font-mono text-[10px] text-muted-foreground">.sh</div></div>
                  </button>
                  <button onClick={exportPDF}
                    className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-4 hover:border-destructive/50 hover:bg-destructive/5 transition-all group">
                    <FileText className="h-7 w-7 text-muted-foreground group-hover:text-destructive" />
                    <div className="text-center"><div className="text-[13px] font-semibold group-hover:text-destructive">PDF Report</div><div className="font-mono text-[10px] text-muted-foreground">.pdf</div></div>
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 px-1">
                <div className="h-px flex-1 bg-border" />
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {remediationSteps.length} action{remediationSteps.length !== 1 ? "s" : ""} · click to expand
                </div>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-3">
                {remediationSteps.map((s, i) => (
                  <RemediationStepCardInline key={i} step={s} index={s.order ?? i + 1} />
                ))}
              </div>
            </div>
          )
        )}
      </TabsContent>

      {/* ── Specs (shared) ── */}
      <TabsContent value="specs" className="mt-4 space-y-4">
        <div className="glass-panel rounded-xl overflow-hidden">
          <TableHeader cols={["Component", "Version", "Source"]} />
          <div className="divide-y divide-border">
            {allSpecs.length === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">No specs available. Run an evaluation first.</div>
            ) : allSpecs.map((s, i) => (
              <div key={i} className="grid gap-3 px-4 py-2.5 text-[13px] hover:bg-muted/10" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
                <div className="font-mono text-[12px]">{s.component}</div>
                <div className="font-mono text-[12px] text-primary">{s.version}</div>
                <div className="font-mono text-[10px] text-muted-foreground uppercase">{s.source ?? "auto"}</div>
              </div>
            ))}
          </div>
        </div>
        <label className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-border hover:border-primary/40 cursor-pointer text-[12px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground">
          Upload Inventory JSON
          <input type="file" accept=".json,application/json" className="hidden" onChange={handleInventoryUpload} />
        </label>
      </TabsContent>

      {/* ── Impact (shared) ── */}
      <TabsContent value="impact" className="mt-4 space-y-4">
        <div className="glass-panel rounded-xl p-5 space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Select a component to analyse its graph dependencies
          </div>
          {deviceComponents.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">No components detected. Run an evaluation first.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {deviceComponents.map((comp) => (
                <button key={comp} onClick={() => loadImpact(comp)}
                  className={cn("inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12px] font-mono transition-all",
                    impactComponent === comp
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                  <Cpu className="h-3 w-3" />{comp}
                </button>
              ))}
            </div>
          )}
          {impactComponent && (
            <div className="flex items-center gap-2 pt-1">
              <span className="font-mono text-[11px] text-muted-foreground">Analysing: <span className="text-primary">{impactComponent}</span></span>
              <button onClick={() => loadImpact(impactComponent)} disabled={impactLoading}
                className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-[11px] font-mono text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50">
                <RefreshCw className={cn("h-3 w-3", impactLoading && "animate-spin")} /> Refresh
              </button>
            </div>
          )}
        </div>
        {impactLoading && <Skeleton className="h-40 w-full" />}
        {!impactLoading && impact && (
          <div className="glass-panel rounded-xl p-5 space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {impact.count} affected component{impact.count !== 1 ? "s" : ""}
              {impact.center && <span className="ml-2 text-primary">· Center: {impact.center}</span>}
            </div>
            <div className="space-y-2">
              {(impact.affected_components ?? []).map((c, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-card/30 text-[12px]">
                  <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border",
                    c.direction === "DEPENDS_ON_THIS" ? "border-blue-500/30 text-blue-400" : "border-emerald-500/30 text-emerald-400")}>
                    {c.direction === "DEPENDS_ON_THIS" ? "↑ DEPENDS ON THIS" : "↓ REQUIRED BY THIS"}
                  </span>
                  <span className="font-mono font-medium">{c.name ?? c.id}</span>
                  <span className="text-muted-foreground ml-auto">{c.relationship}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {!impactLoading && !impact && !impactComponent && (
          <div className="glass-panel rounded-xl p-8 text-center text-muted-foreground text-sm">
            Select a component above to view its dependency impact.
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

// ── Inline RemediationStepCard (self-contained, no external dep) ──────────────

function RemediationStepCardInline({ step, index }: { step: RemediationStep; index: number }) {
  const [open, setOpen] = useState(false);
  const riskColor = step.risk === "CRITICAL" ? "text-destructive" : step.risk === "WARNING" ? "text-warning" : "text-muted-foreground";
  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/10 transition-colors"
      >
        <span className={cn("font-mono text-[11px] font-semibold tabular-nums w-6 shrink-0", riskColor)}>
          {String(index).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate">{step.action}</div>
          {step.reason && <div className="text-[11px] text-muted-foreground truncate">{step.reason}</div>}
        </div>
        {step.risk && <span className={cn("font-mono text-[10px] border px-1.5 py-0.5 rounded shrink-0",
          step.risk === "CRITICAL" ? "border-destructive/40 text-destructive" : "border-warning/40 text-warning")}>{step.risk}</span>}
        <span className="text-muted-foreground text-[11px] ml-1">{open ? "▲" : "▼"}</span>
      </button>
      {open && step.sub_steps && step.sub_steps.length > 0 && (
        <div className="border-t border-border divide-y divide-border/50">
          {step.sub_steps.map((sub, si) => (
            <div key={si} className="px-5 py-3 space-y-1.5">
              <div className="flex items-start gap-2">
                <span className="font-mono text-[10px] text-muted-foreground shrink-0 mt-0.5">{sub.order}.</span>
                <div className="text-[12px]">{sub.description}</div>
              </div>
              {sub.warning && <div className="ml-5 text-[11px] text-warning flex items-center gap-1">⚠ {sub.warning}</div>}
              {sub.note && <div className="ml-5 text-[11px] text-muted-foreground">ℹ {sub.note}</div>}
              {sub.command && (
                <div className="ml-5 font-mono text-[11px] bg-card/60 border border-border rounded px-3 py-2 text-primary/90 overflow-x-auto">
                  {sub.command}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
