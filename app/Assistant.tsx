"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant" | "watch" | "hello"; text: string };
export type Watch = { key: string; text: string };
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void;
  start: () => void; stop: () => void;
};

const verdictOf = (t: string) => /^\s*VERDICT:\s*(CLOSE|HOLD|WAIT|NONE)/i.exec(t)?.[1].toUpperCase() ?? "";
const body = (t: string) => t.replace(/^\s*VERDICT:\s*(CLOSE|HOLD|WAIT|NONE)\s*[.\-:]?\s*/i, "").trim();

const Icon = {
  chat: <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.6A8 8 0 1 1 21 12Z" /><path d="M12 8.2v.01M8.6 12h.01M15.4 12h.01" strokeWidth="2.4" /></svg>,
  x: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  mic: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>,
  send: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
};

// AI assistant: one clean floating button. Tap it to open a small chat window where you can type or talk,
// and it watches the running trades live and tells you when to close.
export default function Assistant({ pair, tfId, secret, openCount, watch, silentWatch, say, warn }: {
  pair: string; tfId: string; secret: string; openCount: number; watch: Watch[];
  silentWatch: boolean;               // the main voice alerts already read the warning out, so the assistant only shows it
  say: (t: string) => void; warn: () => void;
}) {
  const [log, setLog] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [voice, setVoice] = useState(true);
  const [auto, setAuto] = useState(false);
  const [mic, setMic] = useState(false);
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const greeted = useRef(false);
  const rec = useRef<Rec | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const logRef = useRef<HTMLDivElement>(null);
  const logState = useRef<Msg[]>([]);
  const busyRef = useRef(false);
  const openRef = useRef(false);
  logState.current = log; openRef.current = open;

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log, open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  // Live watch: the bot's own order-change check says a trade should be closed. Shown once, spoken once.
  useEffect(() => {
    const fresh = watch.filter((w) => !seen.current.has(w.key));
    if (!fresh.length) return;
    fresh.forEach((w) => seen.current.add(w.key));
    setLog((l) => [...l, ...fresh.map((w) => ({ role: "watch" as const, text: w.text }))]);
    if (!openRef.current) setUnseen((n) => n + fresh.length);
    if (silentWatch) return;
    warn();
    if (voice) say(`Close advice. ${fresh[0].text}`);
  }, [watch, voice, silentWatch, say, warn]);

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busyRef.current) return;
    if (!secret) { setErr("Enter the bot password in Bot settings first. It is the BOT_SECRET you set in Cloudflare."); return; }
    busyRef.current = true; setBusy(true); setErr(""); setText("");
    const next: Msg[] = [...logState.current, { role: "user", text: q }];
    setLog(next);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json", "x-bot-secret": secret },
        body: JSON.stringify({ pair, tf: tfId, messages: next.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.text })) }),
      });
      const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !j.text) { setErr(j.error ?? "The assistant could not answer."); return; }
      setLog((l) => [...l, { role: "assistant", text: j.text! }]);
      if (!openRef.current) setUnseen((n) => n + 1);
      if (verdictOf(j.text) === "CLOSE") warn();
      if (voice) say(body(j.text).replace(/%/g, " percent"));
    } catch { setErr("Could not reach the assistant. Try again."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  // Automatic review while a trade is running (uses AI credit, so it is off until you switch it on)
  const askRef = useRef(ask); askRef.current = ask;
  useEffect(() => {
    if (!auto || openCount === 0) return;
    const go = () => askRef.current("Review my running trades now on the live chart. Should I close any of them?");
    const id = setInterval(go, 120000);
    return () => clearInterval(id);
  }, [auto, openCount]);

  // Tapping the button is a user gesture, so the browser allows the welcome to be spoken
  const toggle = () => {
    if (open) { setOpen(false); return; }
    setOpen(true); setUnseen(0);
    if (greeted.current) return;
    greeted.current = true;
    const hi = "Welcome to Kitibwa, your AI trading assistant.";
    setLog((l) => [{ role: "hello", text: `${hi} I am watching ${pair.replace("_", "/")} on the ${tfId} chart. Ask me anything, or tap the microphone and speak to me. If a running trade needs to be closed, I will tell you.` }, ...l]);
    if (voice) say(`${hi} Ask me anything, or tap the microphone and speak to me.`);
  };

  const talk = () => {
    if (mic) { rec.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) { setErr("This browser has no voice input. Use Chrome, Edge or Safari, or type your question."); return; }
    try {
      const r = new SR();
      r.lang = "en-US"; r.interimResults = false; r.continuous = false;
      r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript ?? ""; if (t) ask(t); };
      r.onend = () => setMic(false);
      r.onerror = () => { setMic(false); setErr("The microphone did not work. Allow microphone access for this site, or type instead."); };
      rec.current = r; setMic(true); setErr(""); r.start();
    } catch { setMic(false); }
  };

  const danger = unseen > 0 && log.some((m) => m.role === "watch");

  return (
    <>
      {open && (
        <section className="aipanel" role="dialog" aria-label="AI trading assistant">
          <header className="aihead">
            <div>
              <div className="aititle"><span className="aidot" />Kitibwa AI</div>
              <div className="aisub">{pair.replace("_", "/")} | {tfId}{openCount > 0 ? ` | watching ${openCount} trade${openCount > 1 ? "s" : ""}` : ""}</div>
            </div>
            <button className="aiicon" onClick={() => setOpen(false)} aria-label="Hide the assistant">{Icon.x}</button>
          </header>

          <div className="aichat" ref={logRef} aria-live="polite">
            {log.map((m, i) => {
              const v = m.role === "assistant" ? verdictOf(m.text) : m.role === "watch" ? "CLOSE" : "";
              return (
                <div key={i} className={`bub ${m.role === "hello" ? "assistant" : m.role} ${v === "CLOSE" ? "closeit" : ""}`}>
                  {v && <span className={`tag ${v === "CLOSE" ? "r" : v === "HOLD" ? "g" : ""}`}>{m.role === "watch" ? "LIVE WATCH: CLOSE" : v}</span>}
                  <div>
                    {m.role === "hello" ? <><b>{m.text.split(". ")[0]}.</b>{` ${m.text.slice(m.text.indexOf(". ") + 2)}`}</> : m.role === "assistant" ? body(m.text) : m.text}
                  </div>
                </div>
              );
            })}
            {busy && <div className="small">Reading the chart...</div>}
          </div>

          {err && <div className="error aierr">{err}</div>}

          <div className="aifoot">
            <div className="aipills">
              <button className="aipill" onClick={() => ask("Should I close my running trade now?")} disabled={busy}>Should I close?</button>
              <button className="aipill" onClick={() => ask("Give me a quick read of this chart.")} disabled={busy}>Read chart</button>
              <button className={`aipill ${voice ? "on" : ""}`} onClick={() => setVoice(!voice)} aria-pressed={voice}>Voice {voice ? "on" : "off"}</button>
              <button className={`aipill ${auto ? "on" : ""}`} onClick={() => setAuto(!auto)} aria-pressed={auto} title="Asks the AI every 2 minutes while a trade runs. Uses AI credit.">Auto review {auto ? "on" : "off"}</button>
            </div>
            <div className="aibar">
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(text); }} placeholder="Ask about this chart..." aria-label="Ask the assistant" maxLength={500} />
              <button className={`aiicon ${mic ? "live" : ""}`} onClick={talk} aria-pressed={mic} aria-label={mic ? "Listening, tap to stop" : "Talk to the assistant"}>{Icon.mic}</button>
              <button className="aiicon send" onClick={() => ask(text)} disabled={busy || !text.trim()} aria-label="Send">{Icon.send}</button>
            </div>
            <div className="aifine">Advice only. It cannot place or close orders. Not financial advice.</div>
          </div>
        </section>
      )}

      <button className={`fab ${open ? "open" : ""} ${danger ? "danger" : ""} ${mic ? "live" : ""}`} onClick={toggle} aria-label={open ? "Hide the AI assistant" : "Open the AI assistant"} aria-expanded={open} title="AI assistant">
        {open ? Icon.x : Icon.chat}
        {!open && unseen > 0 && <span className="fabbadge">{unseen > 9 ? "9+" : unseen}</span>}
        {!open && openCount > 0 && unseen === 0 && <span className="fabwatch" aria-hidden="true" />}
      </button>
    </>
  );
}
