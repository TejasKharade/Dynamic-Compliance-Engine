import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api, ApiError, ChatResponse } from "@/lib/api";
import { Sparkles, Send, Loader2, User, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };
const STORAGE_KEY = "complianceiq.chat.history";
const SESSION_ID_KEY = "complianceiq.chat.session";

export default function Assistant() {
  const [sessionId, setSessionId] = useState(() => {
    if (typeof window === "undefined") return "session-" + Math.random().toString(36).substring(2, 9);
    return sessionStorage.getItem(SESSION_ID_KEY) || "session-" + Math.random().toString(36).substring(2, 9);
  });
  const [messages, setMessages] = useState<Msg[]>(() => {
    if (typeof window === "undefined") return [];
    try { const raw = sessionStorage.getItem(STORAGE_KEY); return raw ? (JSON.parse(raw) as Msg[]) : []; } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef            = useRef<HTMLDivElement>(null);
  const inputRef          = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sessionId]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res: ChatResponse = await api.chat({ question: text, session_id: sessionId });
      setMessages((m) => [...m, { role: "assistant", content: res.answer ?? "(no response)", tools: res.tools_used }]);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const clearHistory = () => {
    setMessages([]);
    setSessionId("session-" + Math.random().toString(36).substring(2, 9));
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_ID_KEY);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-background text-foreground relative overflow-hidden animate-in fade-in duration-700">
      
      {/* Ambient background glow for AI */}
      <div className="pointer-events-none absolute top-[20%] left-1/2 -translate-x-1/2 h-[600px] w-[800px] rounded-full bg-ai/5 blur-[120px]" />

      {/* ── Header ── */}
      <div className="relative z-10 px-6 py-4 border-b border-border/50 bg-card/30 backdrop-blur-md flex items-center gap-4 shadow-sm">
        <div className="h-10 w-10 rounded-xl grid place-items-center bg-gradient-to-br from-ai/20 to-ai/5 border border-ai/30 shadow-inner">
          <Sparkles className="h-5 w-5 text-ai" />
        </div>
        <div className="flex-1">
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-semibold">AI-powered guidance</div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-foreground tracking-tight">
            Compliance Assistant
            <span className="font-mono text-[10px] tracking-widest text-ai border border-ai/40 px-2 py-0.5 rounded bg-ai/10 font-bold shadow-[0_0_10px_rgba(var(--ai),0.2)]">AI</span>
          </h1>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            title="Clear history"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border/50 bg-background/50 text-[12px] font-mono font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10 transition-all shadow-sm"
          >
            <Trash2 className="h-4 w-4" /> Clear
          </button>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-auto scrollbar-thin relative z-10">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="text-center py-16 space-y-6 max-w-2xl mx-auto glass-panel rounded-3xl border border-border/50 bg-card/20 backdrop-blur-md shadow-2xl mt-10 relative overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-ai/50 to-transparent" />
              <div className="h-20 w-20 rounded-full mx-auto grid place-items-center bg-gradient-to-b from-ai/20 to-transparent border border-ai/30 shadow-[0_0_30px_rgba(var(--ai),0.15)]">
                <Sparkles className="h-10 w-10 text-ai opacity-90" />
              </div>
              <div className="space-y-2">
                <div className="text-foreground font-extrabold text-2xl tracking-tight">Ask the Engine Anything</div>
                <div className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                  Examples: "Which devices have BIOS conflicts?", "Why is server R750-04 non-compliant?", "What is the remediation for the latest blocker?"
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-3 pt-4 px-6">
                {[
                  "Show me all critical violations",
                  "Which devices need BIOS upgrade?",
                  "List all non-compliant servers",
                  "What rules were ingested?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="text-[13px] font-medium px-4 py-2 rounded-xl border border-border/50 text-muted-foreground hover:border-ai/50 hover:bg-ai/5 hover:text-ai transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 bg-background/50 backdrop-blur-sm"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message bubbles */}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex gap-4 group", m.role === "user" ? "justify-end" : "justify-start")}>

              {/* AI avatar */}
              {m.role === "assistant" && (
                <div className="h-8 w-8 rounded-full grid place-items-center bg-gradient-to-br from-ai/20 to-ai/5 border border-ai/30 shrink-0 mt-1 shadow-[0_0_15px_rgba(var(--ai),0.1)]">
                  <Sparkles className="h-4 w-4 text-ai" />
                </div>
              )}

              {/* Bubble */}
              <div className={cn(
                "max-w-[85%] px-5 py-4 text-[14px] leading-relaxed shadow-md transition-all",
                m.role === "user"
                  ? "bg-gradient-to-tr from-primary to-primary/80 text-primary-foreground rounded-2xl rounded-tr-sm"
                  : "bg-card/80 backdrop-blur-md border border-border/60 border-l-2 border-l-ai text-foreground rounded-2xl rounded-tl-sm hover:shadow-lg",
              )}>
                {m.role === "assistant" && (
                  <div className="font-mono text-[10px] font-bold tracking-widest text-ai mb-3 uppercase flex items-center gap-2">
                    <Sparkles className="h-3 w-3" /> AI Engine
                  </div>
                )}

                {/*
                  KEY FIX: `prose-invert` was hardcoded — it forces ALL prose text to white,
                  making it invisible on a light background.
                  Fix: use `dark:prose-invert` so inversion only applies in dark mode.
                  In light mode, Tailwind Typography uses dark text by default.
                  Semantic overrides via CSS variables ensure all text respects the theme.
                */}
                <div className={cn(
                  "prose prose-sm max-w-none",
                  // Only invert prose colours in dark mode
                  "dark:prose-invert",
                  // Semantic overrides — use CSS-var-based colours that flip with theme
                  "prose-p:my-2 prose-p:text-foreground",
                  "prose-headings:text-foreground prose-headings:font-semibold",
                  "prose-strong:text-foreground prose-strong:font-semibold",
                  "prose-em:text-foreground/80",
                  "prose-code:text-ai prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none",
                  "prose-pre:bg-card prose-pre:border prose-pre:border-border prose-pre:text-[12px] prose-pre:text-foreground",
                  "prose-li:text-foreground prose-li:my-0.5",
                  "prose-ul:text-foreground prose-ol:text-foreground",
                  "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
                  "prose-blockquote:text-muted-foreground prose-blockquote:border-l-ai",
                  // User bubble overrides — keep text white on blue
                  m.role === "user" && [
                    "prose-p:text-primary-foreground",
                    "prose-strong:text-primary-foreground",
                    "prose-li:text-primary-foreground",
                    "prose-ul:text-primary-foreground",
                    "prose-headings:text-primary-foreground",
                  ].join(" "),
                )}>
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>

                {/* Tool badges */}
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1 pt-2 border-t border-border/40">
                    <span className="font-mono text-[9px] text-muted-foreground mr-1">via:</span>
                    {m.tools.map((t) => (
                      <span key={t} className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded border border-ai/30 text-ai bg-ai/5">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* User avatar */}
              {m.role === "user" && (
                <div className="h-8 w-8 rounded-full grid place-items-center bg-primary/10 border border-primary/30 shrink-0 mt-1">
                  <User className="h-4 w-4 text-primary" />
                </div>
              )}
            </div>
          ))}

          {/* Thinking indicator */}
          {busy && (
            <div className="flex gap-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="h-8 w-8 rounded-full grid place-items-center bg-gradient-to-br from-ai/20 to-ai/5 border border-ai/30 shrink-0 shadow-[0_0_15px_rgba(var(--ai),0.1)]">
                <Sparkles className="h-4 w-4 text-ai animate-pulse" />
              </div>
              <div className="px-5 py-4 rounded-2xl rounded-tl-sm bg-card/80 backdrop-blur-md border border-border/60 border-l-2 border-l-ai shadow-md">
                <div className="flex items-center gap-2">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="h-2 w-2 rounded-full bg-ai animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />
                  ))}
                  <span className="font-mono text-[11px] font-bold text-ai ml-2 uppercase tracking-wider">Analyzing Context…</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive font-mono px-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">{error}</div>
          )}
          <div ref={endRef} className="h-4" />
        </div>
      </div>

      {/* ── Input area ── */}
      <div className="relative z-20 border-t border-border/40 bg-background/60 backdrop-blur-xl p-4 md:p-6 pb-6 md:pb-8">
        <div className="max-w-4xl mx-auto">
          <div className="relative group">
            {/* Glowing border effect */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-ai/40 to-primary/40 rounded-2xl blur opacity-30 group-focus-within:opacity-70 transition duration-500" />
            
            <div className="relative flex items-end gap-3 rounded-2xl border border-border/60 bg-card/90 px-4 py-3 shadow-xl focus-within:border-ai/50 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask about compliance, devices, rules, remediation…"
                rows={1}
                className="flex-1 bg-transparent outline-none text-[14px] font-medium resize-none max-h-40 py-2 text-foreground placeholder:text-muted-foreground/60"
              />
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="h-10 w-10 shrink-0 grid place-items-center rounded-xl bg-gradient-to-br from-ai to-ai/80 text-white disabled:opacity-40 hover:opacity-100 transition-all shadow-md hover:shadow-ai/30 hover:-translate-y-0.5"
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 ml-0.5" />}
              </button>
            </div>
          </div>
          <div className="font-mono text-[11px] font-medium text-muted-foreground/60 mt-3 text-center">
            Press <kbd className="px-1.5 py-0.5 rounded border border-border/50 bg-muted/50 text-foreground text-[10px]">Enter</kbd> to send ·{" "}
            <kbd className="px-1.5 py-0.5 rounded border border-border/50 bg-muted/50 text-foreground text-[10px]">Shift+Enter</kbd> for newline · History is saved locally
          </div>
        </div>
      </div>
    </div>
  );
}
