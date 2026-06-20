import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  LayoutGrid,
  Network,
  FileStack,
  MessagesSquare,
  Activity,
  Search,
  Menu,
  X,
  ServerCog,
} from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { api, API_BASE_URL } from "@/lib/api";
import { ThemeToggle } from "./ThemeToggle";

const navItems = [
  { to: "/", label: "Fleet Overview", icon: LayoutGrid, end: true },
  { to: "/graph", label: "Knowledge Graph", icon: Network },
  { to: "/rules", label: "Rule Ingestion", icon: FileStack },
  { to: "/assistant", label: "AI Assistant", icon: MessagesSquare, ai: true },
  { to: "/status", label: "System Status", icon: Activity },
];

function useBackendHealth() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    const ping = () =>
      api
        .health()
        .then(() => mounted && setOk(true))
        .catch(() => mounted && setOk(false));
    ping();
    const id = setInterval(ping, 20000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);
  return ok;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const health = useBackendHealth();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed md:sticky top-0 z-50 h-screen w-60 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col transition-transform",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border">
          <Logo />
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors",
                  isActive
                    ? item.ai
                      ? "bg-ai/10 text-ai border border-ai/30"
                      : "bg-primary/10 text-primary border border-primary/30"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border border-transparent",
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.ai && (
                <span className="font-mono text-[9px] tracking-wider text-ai">AI</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Backend</span>
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  health === true
                    ? "bg-success shadow-[0_0_8px_hsl(var(--success))]"
                    : health === false
                      ? "bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]"
                      : "bg-muted-foreground animate-pulse",
                )}
              />
              {health === true ? "ONLINE" : health === false ? "OFFLINE" : "PING…"}
            </span>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground/70 truncate" title={API_BASE_URL}>
            {API_BASE_URL}
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur-md flex items-center gap-3 px-4">
          <button
            onClick={() => setOpen((o) => !o)}
            className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-border text-muted-foreground hover:text-foreground"
            aria-label="Toggle navigation"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="hidden md:flex items-center gap-2 flex-1 max-w-md h-9 rounded-md border border-border bg-card/50 px-3 text-muted-foreground">
            <Search className="h-4 w-4" />
            <input
              type="text"
              placeholder="Search devices, components, rules…"
              className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden lg:inline-flex font-mono text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </div>
          <div className="flex-1 md:flex-none" />
          <div className="flex items-center gap-2">
            <Link
              to="/status"
              className="hidden sm:flex items-center gap-2 px-2.5 h-9 rounded-md border border-border bg-card/50 hover:bg-card text-[11px] font-mono uppercase tracking-wider text-muted-foreground"
            >
              <ServerCog className="h-3.5 w-3.5" />
              <span>
                Engine{" "}
                <span
                  className={cn(
                    health === true
                      ? "text-success"
                      : health === false
                        ? "text-destructive"
                        : "text-warning",
                  )}
                >
                  {health === true ? "OK" : health === false ? "DOWN" : "…"}
                </span>
              </span>
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}