import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Search, AlertTriangle, Network, X, RefreshCw, Info } from "lucide-react";

// --- Relationship colour + style map ---

const REL_STYLES: Record<string, { color: string; label: string }> = {
  REQUIRES:        { color: "hsl(217 91% 60%)",  label: "Requires"        },
  CONFLICTS_WITH:  { color: "hsl(0 84% 60%)",    label: "Conflicts With"  },
  COMPATIBLE_WITH: { color: "hsl(142 71% 45%)",  label: "Compatible With" },
  RECOMMENDS:      { color: "hsl(270 60% 65%)",  label: "Recommends"      },
  WARNS_AGAINST:   { color: "hsl(38 92% 55%)",   label: "Warns Against"   },
};
const DEFAULT_REL_COLOR = "hsl(215 20% 50%)";

function relColor(rel?: string) {
  return REL_STYLES[rel ?? ""]?.color ?? DEFAULT_REL_COLOR;
}

// --- Node colours by type ---

const NODE_COLORS: Record<string, string> = {
  FIRMWARE: "hsl(217 91% 65%)",
  DRIVER:   "hsl(142 70% 50%)",
  SOFTWARE: "hsl(270 60% 65%)",
  HARDWARE: "hsl(38 92% 55%)",
  SECURITY: "hsl(0 84% 65%)",
  OS:       "hsl(190 80% 55%)",
};
function nodeColor(type?: string) {
  return NODE_COLORS[(type ?? "").toUpperCase()] ?? "hsl(205 80% 55%)";
}

// --- Raw backend shapes ---
interface RawNode { id: string; type?: string; label?: string; name?: string; [k: string]: unknown }
interface RawEdge {
  source_id?: string; source?: string;
  target_id?: string; target?: string;
  relationship_type?: string; relationship?: string;
  operator?: string; min_version?: string;
  [k: string]: unknown;
}
interface RawGraph { nodes: RawNode[]; edges?: RawEdge[]; links?: RawEdge[] }

// --- Detect current theme (dark = documentElement has no .light class) ---
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => !document.documentElement.classList.contains("light"));
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(!document.documentElement.classList.contains("light"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

// --- Graph Page ---

export default function GraphPage() {
  const [data, setData]         = useState<RawGraph | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [query, setQuery]       = useState("");
  const [selected, setSelected] = useState<RawNode | null>(null);
  const [activeRels, setActiveRels] = useState<Set<string>>(new Set(Object.keys(REL_STYLES)));
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const isDark = useIsDark();

  const fetchGraph = useCallback(() => {
    setLoading(true);
    setError(null);
    api.graphNetwork()
      .then((res) => setData(res as unknown as RawGraph))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Normalise graph: map backend field names to force-graph field names
  const graph = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    const nodes = (data.nodes ?? []).map((n) => ({
      ...n,
      id:   n.id,
      name: n.label ?? n.id,
      type: n.type,
    }));
    const rawEdges: RawEdge[] = (data.edges ?? data.links ?? []);
    const links = rawEdges
      .map((e) => ({
        source:       e.source_id ?? e.source ?? "",
        target:       e.target_id ?? e.target ?? "",
        relationship: e.relationship_type ?? e.relationship ?? "",
        operator:     e.operator,
        min_version:  e.min_version,
      }))
      .filter((e) => e.source && e.target);
    return { nodes, links };
  }, [data]);

  // Filtered links
  const filteredGraph = useMemo(() => ({
    nodes: graph.nodes,
    links: graph.links.filter((l) => activeRels.has(l.relationship)),
  }), [graph, activeRels]);

  // Stats
  const relCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    graph.links.forEach((l) => { counts[l.relationship] = (counts[l.relationship] ?? 0) + 1; });
    return counts;
  }, [graph]);

  const focusNode = useCallback((id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = (graph.nodes as any[]).find((n) => n.id === id);
    if (node && fgRef.current && typeof node.x === "number") {
      fgRef.current.centerAt(node.x, node.y, 600);
      fgRef.current.zoom(4, 600);
      setSelected(node);
    }
  }, [graph.nodes]);

  const toggleRel = (rel: string) => {
    setActiveRels((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel); else next.add(rel);
      return next;
    });
  };

  // Node canvas draw — theme-aware text colours
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawNode = useCallback((node: any, ctx: CanvasRenderingContext2D, scale: number) => {
    const isSel  = selected?.id === node.id;
    const radius = isSel ? 7 : 4.5;
    const color  = nodeColor(node.type);

    // Glow ring for selected node
    if (isSel) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI);
      ctx.fillStyle = color + "2a";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 2, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // Label — theme-aware: dark text on light bg, light text on dark bg
    if (scale > 1.2 || isSel) {
      const label    = String(node.name ?? node.id);
      const fontSize = isSel ? Math.max(4, 11 / scale) : Math.max(3, 9 / scale);
      ctx.font      = `${isSel ? "600 " : ""}${fontSize}px Inter, sans-serif`;
      ctx.textAlign = "center";
      const labelY  = node.y + radius + fontSize + 1;

      if (isDark) {
        // Dark theme: white-ish label with subtle shadow
        ctx.shadowColor   = "rgba(0,0,0,0.7)";
        ctx.shadowBlur    = 3;
        ctx.fillStyle     = isSel ? "#ffffff" : "rgba(220,230,245,0.88)";
        ctx.fillText(label, node.x, labelY);
        ctx.shadowBlur    = 0;
        ctx.shadowColor   = "transparent";
      } else {
        // Light theme: draw a white outline/halo first, then dark text
        ctx.lineWidth     = 3;
        ctx.strokeStyle   = "rgba(255,255,255,0.92)";
        ctx.lineJoin      = "round";
        ctx.strokeText(label, node.x, labelY);
        ctx.fillStyle     = isSel ? "#0a0a0a" : "rgba(20,30,50,0.90)";
        ctx.fillText(label, node.x, labelY);
      }
    }
  }, [selected, isDark]);

  return (
    <div className="relative min-h-[80vh] p-6 space-y-6 max-w-[1600px] mx-auto animate-in fade-in duration-700">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute left-[5%] top-[10%] h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <div className="pointer-events-none absolute right-[5%] bottom-[10%] h-[400px] w-[400px] translate-x-1/3 translate-y-1/3 rounded-full bg-secondary/10 blur-[120px]" />

      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-mono tracking-[0.2em] text-primary uppercase mb-4 shadow-sm">
             <Network className="h-3 w-3" /> // Knowledge Graph
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-foreground/50 bg-clip-text text-transparent">Knowledge Graph Visualizer</h1>
          <p className="text-base text-muted-foreground mt-2 max-w-2xl leading-relaxed">Interactive component dependency network · Drag, zoom, click nodes to inspect</p>
        </div>
        <button
          onClick={fetchGraph}
          disabled={loading}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-lg border border-border/50 bg-card/40 backdrop-blur-sm text-[13px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all shadow-sm hover:shadow-md disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4 text-primary", loading && "animate-spin")} /> Refresh Graph
        </button>
      </div>

      {/* Stats bar */}
      {!loading && !error && graph.nodes.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap">
          <span className="font-mono text-[11px] text-muted-foreground"><span className="text-foreground font-semibold">{graph.nodes.length}</span> nodes</span>
          <span className="font-mono text-[11px] text-muted-foreground"><span className="text-foreground font-semibold">{graph.links.length}</span> edges</span>
          <span className="h-3 w-px bg-border" />
          {Object.entries(relCounts).map(([rel, count]) => (
            <span key={rel} className="font-mono text-[11px] text-muted-foreground flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ background: relColor(rel) }} />
              {count} {rel.toLowerCase().replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-wrap bg-card/30 backdrop-blur-md p-3 rounded-2xl border border-border/50 shadow-lg">
        <div className="flex items-center gap-2 h-10 px-4 rounded-xl border border-border/50 bg-background/50 flex-1 max-w-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 transition-all shadow-inner">
          <Search className="h-4 w-4 text-primary shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query) {
                const hit = (graph.nodes as RawNode[]).find(
                  (n) => String(n.id).toLowerCase().includes(query.toLowerCase()) || String(n.name ?? "").toLowerCase().includes(query.toLowerCase()),
                );
                if (hit) focusNode(hit.id as string);
              }
            }}
            placeholder="Jump to component (Enter to search)…"
            className="flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:font-normal"
          />
          {query && <button onClick={() => setQuery("")} className="hover:bg-muted p-1 rounded-full transition-colors"><X className="h-3 w-3 text-muted-foreground" /></button>}
        </div>

        {/* Relationship filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(REL_STYLES).map(([rel, { color, label }]) => {
            const active = activeRels.has(rel);
            return (
              <button
                key={rel}
                onClick={() => toggleRel(rel)}
                className={cn(
                  "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border font-mono text-[10px] uppercase tracking-wider transition-all",
                  active ? "text-white border-transparent" : "border-border text-muted-foreground opacity-50 hover:opacity-75",
                )}
                style={active ? { background: color } : {}}
                title={`${active ? "Hide" : "Show"} ${label}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {label}
                {relCounts[rel] != null && <span className="opacity-75">({relCounts[rel]})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main layout */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Graph canvas */}
        <div ref={containerRef} className="glass-panel rounded-2xl overflow-hidden relative shadow-2xl border border-border/50 bg-card/20 backdrop-blur-xl" style={{ height: "min(72vh, 760px)" }}>
          {loading && (
            <div className="absolute inset-0 grid place-items-center bg-background/50 backdrop-blur-sm z-20">
              <div className="text-center space-y-4">
                <RefreshCw className="h-8 w-8 text-primary animate-spin mx-auto" />
                <div className="text-sm text-foreground font-semibold tracking-tight">Initializing Graph Engine...</div>
                <div className="text-[11px] text-muted-foreground font-mono">Fetching nodes from Neo4j</div>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center text-center px-6 bg-background/50 backdrop-blur-sm z-20">
              <div className="space-y-4 max-w-md p-8 glass-panel rounded-2xl border-destructive/30">
                <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
                <div className="text-sm font-semibold text-destructive">{error}</div>
                <button onClick={fetchGraph} className="px-4 py-2 bg-destructive/10 text-destructive rounded hover:bg-destructive/20 font-mono text-xs transition-colors">Retry Connection</button>
              </div>
            </div>
          )}
          {!loading && !error && graph.nodes.length === 0 && (
            <div className="absolute inset-0 grid place-items-center text-center px-6 z-20">
              <div className="space-y-4 max-w-sm glass-panel p-8 rounded-2xl">
                <Network className="h-12 w-12 text-muted-foreground/50 mx-auto" />
                <div className="text-lg font-semibold text-foreground tracking-tight">Graph is Empty</div>
                <div className="text-[13px] text-muted-foreground leading-relaxed">
                  Ingest rule documents in the <strong>Rule Management</strong> page to populate the knowledge graph.
                </div>
              </div>
            </div>
          )}
          {!loading && !error && graph.nodes.length > 0 && (
            <ForceGraph2D
              ref={fgRef}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              graphData={filteredGraph as any}
              width={size.w}
              height={size.h}
              backgroundColor={isDark ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)"}
              nodeRelSize={5}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              linkColor={(l: any) => relColor(l.relationship)}
              linkDirectionalArrowLength={5}
              linkDirectionalArrowRelPos={0.88}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              linkWidth={(l: any) => {
                if (!selected) return 1;
                const s = typeof l.source === "object" ? l.source.id : l.source;
                const t = typeof l.target === "object" ? l.target.id : l.target;
                return s === selected.id || t === selected.id ? 2.5 : 0.4;
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              linkDirectionalParticles={(l: any) => {
                const r: string = l.relationship ?? "";
                if (r === "CONFLICTS_WITH") return 3;
                if (r === "REQUIRES" || r === "WARNS_AGAINST") return 2;
                if (r === "RECOMMENDS") return 1;
                return 0;
              }}
              linkDirectionalParticleWidth={2}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              linkDirectionalParticleColor={(l: any) => relColor(l.relationship)}
              nodeCanvasObject={drawNode}
              nodeCanvasObjectMode={() => "replace"}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onNodeClick={(n: any) => { if (selected?.id === n.id) { setSelected(null); return; } focusNode(n.id); }}
              onBackgroundClick={() => setSelected(null)}
              cooldownTicks={120}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
            />
          )}
        </div>

        {/* Inspector sidebar */}
        <aside className="glass-panel rounded-2xl p-6 h-fit lg:sticky lg:top-20 space-y-6 shadow-xl border-border/50 bg-gradient-to-b from-card/60 to-background backdrop-blur-xl">
          <div className="flex items-center justify-between pb-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              <div className="font-semibold text-sm tracking-tight">Inspector panel</div>
            </div>
            {selected && (
              <button onClick={() => setSelected(null)} className="h-6 w-6 flex items-center justify-center rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-all">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {!selected ? (
            <div className="space-y-6">
              <div className="text-[13px] text-muted-foreground leading-relaxed">
                Click any node in the canvas to inspect its exact attributes, version constraints, and relationships.
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Edge Types</div>
                <div className="space-y-1.5">
                  {Object.entries(REL_STYLES).map(([rel, { color, label }]) => (
                    <div key={rel} className="flex items-center gap-2">
                      <span className="h-0.5 w-5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Node Types</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {Object.entries(NODE_COLORS).map(([type, color]) => (
                    <div key={type} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="font-mono text-[10px] text-muted-foreground capitalize">{type.toLowerCase()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <span className="mt-1 h-3 w-3 rounded-full shrink-0" style={{ background: nodeColor(selected.type as string) }} />
                <div>
                  <div className="font-semibold text-[14px] break-all">{String(selected.id)}</div>
                  {selected.type && (
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{String(selected.type)}</div>
                  )}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Connected Edges</div>
                <ul className="space-y-2">
                  {filteredGraph.links
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .filter((l: any) => (l.source.id ?? l.source) === selected.id || (l.target.id ?? l.target) === selected.id)
                    .slice(0, 25)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .map((l: any, i) => {
                      const sId = typeof l.source === "object" ? l.source.id : l.source;
                      const tId = typeof l.target === "object" ? l.target.id : l.target;
                      const isSource = sId === selected.id;
                      const other    = isSource ? tId : sId;
                      const rel: string = l.relationship ?? "unknown";
                      const ver  = l.min_version ? `${l.operator ?? ">="} ${l.min_version}` : null;
                      return (
                        <li key={i} className="flex items-start gap-2 text-[11px]">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: relColor(rel) }} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span
                                className="font-mono text-[9px] uppercase tracking-wider px-1 py-0.5 rounded"
                                style={{ background: relColor(rel) + "30", color: relColor(rel) }}
                              >
                                {rel.replace(/_/g, " ")}
                              </span>
                              {!isSource && <span className="text-muted-foreground text-[9px]">← incoming</span>}
                            </div>
                            <button
                              className="text-primary hover:underline truncate font-mono text-[11px] mt-0.5 block"
                              onClick={() => focusNode(other)}
                            >
                              {other}
                            </button>
                            {ver && <div className="font-mono text-[9px] text-muted-foreground">{ver}</div>}
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
