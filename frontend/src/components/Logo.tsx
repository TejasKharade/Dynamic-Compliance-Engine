import { cn } from "@/lib/utils";

export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="drop-shadow-[0_0_8px_hsl(var(--primary)/0.55)]"
      >
        <rect
          x="2"
          y="2"
          width="28"
          height="28"
          rx="6"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          fill="hsl(var(--primary) / 0.08)"
        />
        <path
          d="M9 16 L14 21 L23 11"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
          fill="none"
        />
        <circle cx="24" cy="8" r="2" fill="hsl(var(--ai))" />
      </svg>
      <div className="leading-none">
        <div className="font-semibold tracking-[0.12em] text-[13px] uppercase text-foreground">
          Compliance<span className="text-primary">IQ</span>
        </div>
        <div className="font-mono text-[9px] text-muted-foreground tracking-wider mt-0.5">
          DELL ENTERPRISE
        </div>
      </div>
    </div>
  );
}