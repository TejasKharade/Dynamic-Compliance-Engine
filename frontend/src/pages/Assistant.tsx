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
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-background text-foreground">

      {/* ── Header ── */}
      <div className="px-6 py-4 border-b border-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-md grid place-items-center bg-ai/10 border border-ai/30">
          <Sparkles className="h-4 w-4 text-ai" />
        </div>
        <div className="flex-1">
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">AI-powered guidance</div>
          <h1 className="text-lg font-semibold flex items-center gap-2 text-foreground">
            Compliance Assistant
            <span className="font-mono text-[9px] tracking-wider text-ai border border-ai/40 px-1.5 rounded-sm bg-ai/5">AI</span>
          </h1>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            title="Clear history"
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-[11px] font-mono text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="text-center py-12 space-y-4">
              <div className="h-16 w-16 rounded-2xl mx-auto grid place-items-center bg-ai/10 border border-ai/30">
                <Sparkles className="h-8 w-8 text-ai opacity-80" />
              </div>
              <div className="text-foreground font-semibold text-lg">Ask the compliance engine anything.</div>
              <div className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                Examples: "Which devices have BIOS conflicts?", "Why is server R750-04 non-compliant?", "What is the remediation for the latest blocker?"
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {[
                  "Show me all critical violations",
                  "Which devices need BIOS upgrade?",
                  "List all non-compliant servers",
                  "What rules were ingested?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="text-[12px] px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:border-ai/50 hover:text-ai transition-colors bg-card/50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message bubbles */}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex gap-3", m.role === "user" ? "justify-end" : "justify-start")}>

              {/* AI avatar */}
              {m.role === "assistant" && (
                <div className="h-7 w-7 rounded-md grid place-items-center bg-ai/10 border border-ai/30 shrink-0 mt-0.5">
                  <Sparkles className="h-3.5 w-3.5 text-ai" />
                </div>
              )}

              {/* Bubble */}
              <div className={cn(
                "max-w-[80%] px-4 py-3 rounded-xl text-[13.5px] leading-relaxed",
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-card border border-border border-l-2 border-l-ai text-foreground rounded-bl-sm shadow-sm",
              )}>
                {m.role === "assistant" && (
                  <div className="font-mono text-[9px] tracking-wider text-ai mb-2 uppercase">AI Response</div>
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
                <div className="h-7 w-7 rounded-md grid place-items-center bg-primary/10 border border-primary/30 shrink-0 mt-0.5">
                  <User className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
            </div>
          ))}

          {/* Thinking indicator */}
          {busy && (
            <div className="flex gap-3">
              <div className="h-7 w-7 rounded-md grid place-items-center bg-ai/10 border border-ai/30 shrink-0">
                <Sparkles className="h-3.5 w-3.5 text-ai animate-pulse" />
              </div>
              <div className="px-4 py-2.5 rounded-xl bg-card border border-border border-l-2 border-l-ai shadow-sm">
                <div className="flex items-center gap-1.5">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 rounded-full bg-ai animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />
                  ))}
                  <span className="font-mono text-[11px] text-ai ml-1 uppercase tracking-wider">Thinking…</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive font-mono px-1">{error}</div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* ── Input area ── */}
      <div className="border-t border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto p-4">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-card/70 px-3 py-2 focus-within:border-ai/50 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask about compliance, devices, rules, remediation…"
              rows={1}
              className="flex-1 bg-transparent outline-none text-[13.5px] resize-none max-h-40 py-1.5 text-foreground placeholder:text-muted-foreground"
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="h-9 w-9 grid place-items-center rounded-lg bg-ai text-ai-foreground disabled:opacity-40 hover:opacity-90 transition-opacity glow-ai"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground mt-1.5 px-1">
            Press <kbd className="px-1 py-0.5 rounded border border-border bg-muted text-foreground text-[9px]">Enter</kbd> to send ·{" "}
            <kbd className="px-1 py-0.5 rounded border border-border bg-muted text-foreground text-[9px]">Shift+Enter</kbd> for newline · history persisted for this session
          </div>
        </div>
      </div>
    </div>
  );
}
