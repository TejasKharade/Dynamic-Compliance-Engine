import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api, ApiError, ChatResponse } from "@/lib/api";
import { Sparkles, Send, Loader2, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };
const STORAGE_KEY = "complianceiq.chat.history";
const SESSION_ID = "frontend-session";

export default function Assistant() {
  const [messages, setMessages] = useState<Msg[]>(() => {
    if (typeof window === "undefined") return [];
    try { const raw = sessionStorage.getItem(STORAGE_KEY); return raw ? (JSON.parse(raw) as Msg[]) : []; } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      const res: ChatResponse = await api.chat({ question: text, session_id: SESSION_ID });
      setMessages((m) => [...m, { role: "assistant", content: res.answer ?? "(no response)", tools: res.tools_used }]);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="px-6 py-4 border-b border-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-md grid place-items-center bg-ai/10 border border-ai/30"><Sparkles className="h-4 w-4 text-ai" /></div>
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">// AI · POST /chat</div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            Compliance Assistant
            <span className="font-mono text-[9px] tracking-wider text-ai border border-ai/40 px-1.5 rounded-sm bg-ai/5">AI</span>
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
          {messages.length === 0 && (
            <div className="text-center py-12 space-y-3">
              <Sparkles className="h-10 w-10 text-ai mx-auto opacity-70" />
              <div className="text-foreground font-medium">Ask the compliance engine anything.</div>
              <div className="text-sm text-muted-foreground max-w-md mx-auto">Examples: "Which devices have BIOS conflicts?", "Why is server R750-04 non-compliant?", "What is the remediation for the latest blocker?"</div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={cn("flex gap-3", m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "assistant" && (
                <div className="h-7 w-7 rounded-md grid place-items-center bg-ai/10 border border-ai/30 shrink-0"><Sparkles className="h-3.5 w-3.5 text-ai" /></div>
              )}
              <div className={cn("max-w-[80%] px-4 py-2.5 rounded-lg text-[13.5px] leading-relaxed", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border-l-2 border-ai text-foreground/90")}>
                {m.role === "assistant" && (<div className="font-mono text-[9px] tracking-wider text-ai mb-1 uppercase">AI Response</div>)}
                <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-pre:bg-surface-2 prose-pre:text-[12px] prose-code:text-ai prose-a:text-primary">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.tools.map((t) => (
                      <span key={t} className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded border border-ai/30 text-ai bg-ai/5">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              {m.role === "user" && (
                <div className="h-7 w-7 rounded-md grid place-items-center bg-primary/10 border border-primary/30 shrink-0"><User className="h-3.5 w-3.5 text-primary" /></div>
              )}
            </div>
          ))}

          {busy && (
            <div className="flex gap-3">
              <div className="h-7 w-7 rounded-md grid place-items-center bg-ai/10 border border-ai/30"><Sparkles className="h-3.5 w-3.5 text-ai animate-pulse" /></div>
              <div className="px-4 py-2.5 rounded-lg bg-card border-l-2 border-ai text-ai font-mono text-[12px] uppercase tracking-wider">Thinking…</div>
            </div>
          )}
          {error && (<div className="text-sm text-destructive font-mono">{error}</div>)}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto p-4">
          <div className="flex items-end gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 focus-within:border-ai/50">
            <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask about compliance, devices, rules, remediation…" rows={1} className="flex-1 bg-transparent outline-none text-[13.5px] resize-none max-h-40 py-1.5" />
            <button onClick={send} disabled={busy || !input.trim()} className="h-9 w-9 grid place-items-center rounded-md bg-ai text-ai-foreground disabled:opacity-40 hover:opacity-90 glow-ai">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground mt-1.5 px-1">Press Enter to send · Shift+Enter for newline · history persisted for this session</div>
        </div>
      </div>
    </div>
  );
}