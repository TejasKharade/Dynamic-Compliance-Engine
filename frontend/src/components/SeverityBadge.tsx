import { cn } from "@/lib/utils";

export function severityColor(sev?: string) {
  const s = (sev ?? "").toUpperCase();
  if (s === "BLOCKER" || s === "CRITICAL") return "severity-critical";
  if (s === "HIGH") return "severity-high";
  if (s === "WARNING" || s === "MEDIUM") return "severity-medium";
  if (s === "OK" || s === "COMPLIANT" || s === "LOW") return "severity-low";
  return "info";
}

export function SeverityBadge({ severity }: { severity?: string }) {
  const token = severityColor(severity);
  const label = (severity ?? "INFO").toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider border",
      )}
      style={{
        color: `hsl(var(--${token}))`,
        borderColor: `hsl(var(--${token}) / 0.4)`,
        backgroundColor: `hsl(var(--${token}) / 0.08)`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `hsl(var(--${token}))` }}
      />
      {label}
    </span>
  );
}