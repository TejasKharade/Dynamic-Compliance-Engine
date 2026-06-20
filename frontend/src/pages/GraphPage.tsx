import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { api, ApiError, GraphEdge, GraphResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Search, AlertTriangle, Network, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function relColor(rel?: string) {
  const r = (rel ?? "").toLowerCase();
  if (r.includes("conflict")) return "hsl(var(--destructive))";
  if (r.includes("deprecat")) return "hsl(var(--warning))";
  if (r.includes("require")) return "hsl(var(--primary))";
  return "hsl(var(--muted-foreground))";
}

export default function GraphPage() {
  const [view, setView] = useState<"full" | "network">("full");
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ id: string; label?: string; type?: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    setLoading(true);
    setError(null);
    (view === "full" ? api.graphFull() : api.graphNetwork())
      .then((res) => setData(res))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [view]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const graph = useMemo(() => {
    const nodes = (data?.nodes ?? []).map((n) => ({ ...n, id: n.id, name: n.label ?? n.id }));
    const linksRaw: GraphEdge[] = (data?.edges ?? data?.links ?? []) as GraphEdge[];
    const links = linksRaw.map((e) => ({ ...e, source: e.source, target: e.target }));
    return { nodes, links };
  }, [data]);

  const focusNode = (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = graph.nodes.find((n) => n.id === id) as any;
    if (node && fgRef.current && typeof node.x === "number") {
      fgRef.current.centerAt(node.x, node.y, 600);
      fgRef.current.zoom(4, 600);
      setSelected({ id: node.id, label: node.label as string | undefined, type: node.type as string | undefined });
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase mb-1">// Compatibility Graph</div>
          <h1 className="text-2xl font-semibold">Knowledge Graph Visualizer</h1>
          <p className="text-sm text-muted-foreground mt-1">Interactive component compatibility network. Drag, zoom, click any node to inspect.</p>
        </div>
        <div className="inline-flex rounded-md border border-border p-0.5 bg-card/50">
          {(["full", "network"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn("px-3 h-8 rounded text-[11px] font-mono uppercase tracking-wider", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{v} graph</button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-card/50 flex-1 max-w-md">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query) {
                const hit = graph.nodes.find((n) => String(n.id).toLowerCase().includes(query.toLowerCase()) || String(n.name ?? "").toLowerCase().includes(query.toLowerCase()));
                if (hit) focusNode(hit.id as string);
              }
            }}
            placeholder="Jump to component (BIOS, iDRAC, …)"
            className="flex-1 bg-transparent text-[13px] outline-none"
          />
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          {[{ label: "requires", color: "hsl(var(--primary))" }, { label: "conflicts", color: "hsl(var(--destructive))" }, { label: "deprecated", color: "hsl(var(--warning))" }].map((i) => (
            <span key={i.label} className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: i.color }} />{i.label}</span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div ref={containerRef} className="glass-panel rounded-lg overflow-hidden relative" style={{ height: "min(70vh, 720px)" }}>
          {loading && <div className="absolute inset-0 grid place-items-center"><Skeleton className="h-full w-full" /></div>}
          {error && (
            <div className="absolute inset-0 grid place-items-center text-center px-4">
              <div><AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" /><div className="text-sm text-destructive">{error}</div></div>
            </div>
          )}
          {!loading && !error && graph.nodes.length === 0 && (
            <div className="absolute inset-0 grid place-items-center text-center px-4">
              <div><Network className="h-8 w-8 text-muted-foreground mx-auto mb-2" /><div className="text-sm text-muted-foreground">No graph data yet. Ingest rules to populate the compatibility graph.</div></div>
            </div>
          )}
          {!loading && !error && graph.nodes.length > 0 && (
            <ForceGraph2D
              ref={fgRef}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              graphData={graph as any}
              width={size.w}
              height={size.h}
              backgroundColor="rgba(0,0,0,0)"
              nodeRelSize={5}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              linkColor={(l: any) => relColor(l.relationship)}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={0.85}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              linkWidth={(l: any) => (selected && ((l.source.id ?? l.source) === selected.id || (l.target.id ?? l.target) === selected.id) ? 2 : 0.8)}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              nodeCanvasObject={(node: any, ctx, scale) => {
                const label = node.name ?? node.id;
                const isSel = selected?.id === node.id;
                ctx.beginPath();
                ctx.arc(node.x, node.y, isSel ? 6 : 4, 0, 2 * Math.PI);
                ctx.fillStyle = isSel ? "hsl(180 100% 50%)" : "hsl(205 100% 55%)";
                ctx.fill();
                if (isSel) { ctx.lineWidth = 1.5; ctx.strokeStyle = "hsl(180 100% 70%)"; ctx.stroke(); }
                if (scale > 1.2) {
                  ctx.font = `${10 / scale}px Inter, sans-serif`;
                  ctx.fillStyle = "rgba(230,235,245,0.85)";
                  ctx.textAlign = "center";
                  ctx.fillText(String(label), node.x, node.y + 10 / scale);
                }
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onNodeClick={(n: any) => focusNode(n.id)}
            />
          )}
        </div>

        <aside className="glass-panel rounded-lg p-4 h-fit lg:sticky lg:top-20">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Node Inspector</div>
            {selected && (<button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>)}
          </div>
          {!selected ? (
            <div className="text-sm text-muted-foreground">Select a node to view its relationships and affected devices.</div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="font-mono text-[10px] uppercase text-muted-foreground">ID</div>
                <div className="font-mono text-sm text-foreground break-all">{selected.id}</div>
              </div>
              {selected.type && (<div><div className="font-mono text-[10px] uppercase text-muted-foreground">Type</div><div className="text-sm">{selected.type}</div></div>)}
              <div>
                <div className="font-mono text-[10px] uppercase text-muted-foreground mb-1">Edges</div>
                <ul className="space-y-1 text-[12px]">
                  {graph.links
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .filter((l: any) => (l.source.id ?? l.source) === selected.id || (l.target.id ?? l.target) === selected.id)
                    .slice(0, 20)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .map((l: any, i) => {
                      const sId = typeof l.source === "object" ? l.source.id : l.source;
                      const tId = typeof l.target === "object" ? l.target.id : l.target;
                      const other = sId === selected.id ? tId : sId;
                      return (
                        <li key={i} className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: relColor(l.relationship) }} />
                          <span className="font-mono text-[11px] uppercase text-muted-foreground">{l.relationship ?? "rel"}</span>
                          <button className="text-primary hover:underline truncate font-mono" onClick={() => focusNode(other)}>{other}</button>
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