import { cn } from "@/lib/utils";

export type DocumentFamily =
  | "COMPATIBILITY_MATRIX"
  | "PRODUCT_POLICY"
  | "PLATFORM_REQUIREMENTS"
  | "VERSION_SKEW"
  | string;

interface FamilyMeta {
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  /** Tailwind colour classes for the badge */
  badgeClass: string;
  /** Tailwind colour classes for a filled chip */
  chipClass: string;
  /** Gradient for the family panel header */
  gradient: string;
  /** Border accent */
  borderClass: string;
}

export const FAMILY_META: Record<string, FamilyMeta> = {
  COMPATIBILITY_MATRIX: {
    label: "Compatibility Matrix",
    shortLabel: "Compat",
    icon: "🔗",
    description: "Component-to-component version constraints (e.g. Dell BIOS/driver guides).",
    badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    chipClass: "bg-blue-500 text-white",
    gradient: "from-blue-600/20 via-blue-500/10 to-transparent",
    borderClass: "border-blue-500/30",
  },
  PRODUCT_POLICY: {
    label: "Product Policy",
    shortLabel: "Policy",
    icon: "📦",
    description: "Product requirements from the host device (e.g. Docker Desktop system requirements).",
    badgeClass: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    chipClass: "bg-purple-500 text-white",
    gradient: "from-purple-600/20 via-purple-500/10 to-transparent",
    borderClass: "border-purple-500/30",
  },
  PLATFORM_REQUIREMENTS: {
    label: "Platform Requirements",
    shortLabel: "Platform",
    icon: "🖥️",
    description: "OS/platform hardware minimums (e.g. Windows 11 system requirements).",
    badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    chipClass: "bg-emerald-500 text-white",
    gradient: "from-emerald-600/20 via-emerald-500/10 to-transparent",
    borderClass: "border-emerald-500/30",
  },
  VERSION_SKEW: {
    label: "Version Skew Policy",
    shortLabel: "Skew",
    icon: "⚖️",
    description: "Allowed version gaps between co-installed components (e.g. Kubernetes skew policy).",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    chipClass: "bg-amber-500 text-white",
    gradient: "from-amber-600/20 via-amber-500/10 to-transparent",
    borderClass: "border-amber-500/30",
  },
};

const FALLBACK: FamilyMeta = {
  label: "Unknown Family",
  shortLabel: "Unknown",
  icon: "❓",
  description: "Document family not detected.",
  badgeClass: "bg-muted/40 text-muted-foreground border-border",
  chipClass: "bg-muted text-muted-foreground",
  gradient: "from-muted/20 to-transparent",
  borderClass: "border-border",
};

export function getFamilyMeta(family?: string): FamilyMeta {
  if (!family) return FALLBACK;
  return FAMILY_META[family] ?? FALLBACK;
}

/** Inline badge — used in device rows and headers */
export function DocumentFamilyBadge({
  family,
  className,
  showIcon = true,
}: {
  family?: string;
  className?: string;
  showIcon?: boolean;
}) {
  const meta = getFamilyMeta(family);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border",
        "font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap",
        meta.badgeClass,
        className,
      )}
      title={meta.description}
    >
      {showIcon && <span className="text-[11px]">{meta.icon}</span>}
      {meta.shortLabel}
    </span>
  );
}

/** Full-width panel banner — used at top of DeviceDrilldown */
export function DocumentFamilyPanel({ family }: { family?: string }) {
  const meta = getFamilyMeta(family);
  return (
    <div
      className={cn(
        "glass-panel rounded-xl overflow-hidden border",
        meta.borderClass,
      )}
    >
      <div className={cn("bg-gradient-to-r px-5 py-3 flex items-start gap-4", meta.gradient)}>
        <div className="text-3xl mt-0.5 select-none">{meta.icon}</div>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Document Family
            </span>
            <DocumentFamilyBadge family={family} showIcon={false} />
          </div>
          <div className="font-semibold text-[15px]">{meta.label}</div>
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
            {meta.description}
          </div>
        </div>
      </div>

      {/* Family-specific context tips */}
      <div className="px-5 py-3 border-t border-border/50 bg-card/30">
        <FamilyContextTips family={family} />
      </div>
    </div>
  );
}

function FamilyContextTips({ family }: { family?: string }) {
  if (family === "COMPATIBILITY_MATRIX") {
    return (
      <div className="grid grid-cols-3 gap-3 text-[11px]">
        {[
          { icon: "🔍", label: "Version-Specific Rules", desc: "Rules only fire when the exact source version matches" },
          { icon: "⚙️", label: "Bidirectional Check", desc: "Both source and target must be installed components" },
          { icon: "📋", label: "Driver Compatibility", desc: "Validates BIOS, OS, drivers, agents, and firmware" },
        ].map((tip) => (
          <div key={tip.label} className="flex items-start gap-2">
            <span className="text-base mt-0.5">{tip.icon}</span>
            <div>
              <div className="font-semibold text-foreground/80">{tip.label}</div>
              <div className="text-muted-foreground">{tip.desc}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (family === "PRODUCT_POLICY") {
    return (
      <div className="grid grid-cols-3 gap-3 text-[11px]">
        {[
          { icon: "🎯", label: "Policy Anchor", desc: "The product itself is not installed — it defines requirements" },
          { icon: "💾", label: "Hardware Minimums", desc: "Checks RAM, CPU, storage against product requirements" },
          { icon: "🚫", label: "OS Compatibility", desc: "Flags unsupported OS versions for the product" },
        ].map((tip) => (
          <div key={tip.label} className="flex items-start gap-2">
            <span className="text-base mt-0.5">{tip.icon}</span>
            <div>
              <div className="font-semibold text-foreground/80">{tip.label}</div>
              <div className="text-muted-foreground">{tip.desc}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (family === "PLATFORM_REQUIREMENTS") {
    return (
      <div className="grid grid-cols-3 gap-3 text-[11px]">
        {[
          { icon: "🖥️", label: "OS-Matched", desc: "Rules only apply when device runs the specified OS version" },
          { icon: "📏", label: "Numeric Hardware Checks", desc: "Compares GB RAM, TOPS, GHz numerically — not as semver" },
          { icon: "🔒", label: "Platform Security", desc: "Validates TPM, Secure Boot, UEFI firmware requirements" },
        ].map((tip) => (
          <div key={tip.label} className="flex items-start gap-2">
            <span className="text-base mt-0.5">{tip.icon}</span>
            <div>
              <div className="font-semibold text-foreground/80">{tip.label}</div>
              <div className="text-muted-foreground">{tip.desc}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (family === "VERSION_SKEW") {
    return (
      <div className="grid grid-cols-3 gap-3 text-[11px]">
        {[
          { icon: "📐", label: "Minor Version Gap", desc: "Evaluates skew as minor version distance between components" },
          { icon: "⬆️", label: "Skew Direction", desc: "Detects both 'too new' and 'too old' violations separately" },
          { icon: "🔄", label: "Cluster Health", desc: "Validates kubelet, kubectl, kube-proxy relative to apiserver" },
        ].map((tip) => (
          <div key={tip.label} className="flex items-start gap-2">
            <span className="text-base mt-0.5">{tip.icon}</span>
            <div>
              <div className="font-semibold text-foreground/80">{tip.label}</div>
              <div className="text-muted-foreground">{tip.desc}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}
