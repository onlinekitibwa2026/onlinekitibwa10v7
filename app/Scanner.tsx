"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TradingViewChart from "./TradingViewChart";
import NewsPredict from "./NewsPredict";
import Assistant, { type Watch } from "./Assistant";
import { INSTRUMENTS, TIMEFRAMES, instOf, tfOf } from "../lib/config";
import type { Filled, Pending, Setup } from "../lib/engine";
import { clean, DEFAULTS, STRATEGIES, type BotSettings } from "../lib/settings";
import { ACTION_TEXT } from "../lib/notify";
import { duck, startAmbient, stopAmbient } from "../lib/ambient";

type Res = {
  htf: string; ltf: string; bias: string | null; inSession: boolean; sessionOn: boolean; closed: boolean;
  decision: { action: string; why: string }; setups: Setup[]; pending: Pending[]; filled?: Filled[];
};
type Scan = { demo: boolean; error?: string; at: string; results: Record<string, Res> };
type Px = { demo: boolean; source?: string; bid: number; ask: number; mid: number };
type BotRow = {
  instrument: string; skipped?: string; tf?: string; kind?: string; dir?: string; strategy?: string;
  entry?: string; sl?: string; tp?: string; rr?: number; ok?: boolean; reason?: string; sent?: string;
};
type Bot = { at: Date; status: number; error?: string; skipped?: string; results?: BotRow[]; keys?: string[] };

const KEY = "kitibwa.settings.v2";
const SENT = "kitibwa.sent.v1";
const THEME_KEY = "kitibwa.theme.v1";
const MUSIC_KEY = "kitibwa.music.v1";
// Three colour designs. The colours themselves live in globals.css; bg/grid colour the TradingView chart to match.
const THEMES = [
  { id: "noir", name: "Gold Noir", bg: "#07070a", grid: "rgba(212,175,55,0.08)" },
  { id: "ocean", name: "Ocean Neon", bg: "#040a18", grid: "rgba(34,211,238,0.09)" },
  { id: "royal", name: "Royal Violet", bg: "#090513", grid: "rgba(167,139,250,0.10)" },
] as const;

function beep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    [880, 1175, 880].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = "sine"; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.start(t); o.stop(t + 0.21);
    });
  } catch {}
}
// Lower, doubled tone for an order-change warning so it sounds different from a new signal
function beepWarn() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    [520, 400, 520, 400].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = "triangle"; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.2;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t); o.stop(t + 0.19);
    });
  } catch {}
}
// ---- Voice: a lady's soft, clear voice ----
// The browser decides which voices exist, so the bot picks the best female English voice on this device.
// "Change voice" cycles through the other female voices and the choice is remembered.
const VOICE_KEY = "kitibwa.voice.v1";
const FEMALE = /natural|aria|jenny|sonia|libby|ava\b|emma|michelle|natasha|clara|samantha|karen|moira|serena|tessa|allison|susan|zira|hazel|victoria|fiona|female|catherine|linda|heera|eva\b|salli|joanna|kendra|kimberly|ivy|amy\b|nicky|joelle|ellen/i;
const MALE = /\bmale\b|david|mark\b|george|daniel|james|alex\b|fred\b|guy\b|ryan|davis|thomas|oliver|rishi|ravi|arthur|aaron|gordon|christopher|eric|roger|steffan|brian|andrew|jason|tony|liam|sam\b/i;
let chosen: SpeechSynthesisVoice | null = null;
function ladyVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const vs = window.speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang) && !MALE.test(v.name));
  const score = (v: SpeechSynthesisVoice) => (FEMALE.test(v.name) ? 10 : 0) + (/natural|online/i.test(v.name) ? 5 : 0) + (/en[-_](us|gb)/i.test(v.lang) ? 1 : 0) + (v.localService ? 0 : 1);
  return [...vs].sort((x, y) => score(y) - score(x)).filter((v, i, all) => FEMALE.test(v.name) || i === 0 || !all.some((o) => FEMALE.test(o.name)));
}
function pickVoice(): SpeechSynthesisVoice | null {
  if (chosen) return chosen;
  const list = ladyVoices();
  if (!list.length) return null;
  let saved = ""; try { saved = localStorage.getItem(VOICE_KEY) ?? ""; } catch {}
  chosen = list.find((v) => v.name === saved) ?? list[0];
  return chosen;
}
function nextVoice(): string {
  const list = ladyVoices();
  if (!list.length) return "";
  const i = list.findIndex((v) => v.name === chosen?.name);
  chosen = list[(i + 1) % list.length];
  try { localStorage.setItem(VOICE_KEY, chosen.name); } catch {}
  return chosen.name;
}
if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = () => { chosen = null; };

// Numbers are read digit by digit after the point (4139.40 becomes "4139 point 4 0"), so nothing is misheard.
const num = (n: number, dp: number) => { const [i, d] = n.toFixed(dp).split("."); return d ? `${i} point ${d.split("").join(" ")}` : i; };
const SAY_PAIR: Record<string, string> = { EUR_USD: "Euro Dollar", GBP_USD: "Pound Dollar", USD_JPY: "Dollar Yen", USD_CAD: "Dollar Canadian", AUD_USD: "Aussie Dollar", XAU_USD: "Gold", BTC_USD: "Bitcoin Dollar" };
const SAY_TF: Record<string, string> = { M1: "1 minute", M5: "5 minute", M15: "15 minute", M30: "30 minute", H1: "1 hour", H4: "4 hour", D: "daily", W: "weekly", M: "monthly" };
const SAY_STRAT: Record<string, string> = { CRT: "C R T", CISD: "C I S D", "MSNR+LIT": "M S N R and L I T" };

function speak(text: string, queue = false) {
  try {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    if (!queue || synth.pending) synth.cancel(); // test and on/off messages replace; alerts wait their turn, but never pile up
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-US";
    u.rate = 0.9; u.pitch = 1.08; u.volume = 0.95;
    const quiet = () => setTimeout(() => { if (!synth.speaking && !synth.pending) duck(false); }, 250);
    u.onstart = () => duck(true); u.onend = quiet; u.onerror = quiet;
    synth.speak(u);
  } catch {}
}
function notify(title: string, body: string) {
  try { if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body }); } catch {}
}
const clock = (d: Date | string) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Chip list where several can be on at once
function Multi({ all, on, set, label }: { all: { id: string; label: string }[]; on: string[]; set: (v: string[]) => void; label: string }) {
  const flip = (id: string) => set(on.includes(id) ? on.filter((x) => x !== id) : [...on, id]);
  return (
    <div>
      <div className="label">{label}</div>
      <div className="chips wrapchips">
        {all.map((a) => (
          <button key={a.id} onClick={() => flip(a.id)} className={`chip ${on.includes(a.id) ? "on" : ""}`} aria-pressed={on.includes(a.id)}>{a.label}</button>
        ))}
      </div>
    </div>
  );
}
function Num({ label, v, set, step = 1, hint }: { label: string; v: number; set: (n: number) => void; step?: number; hint?: string }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input type="number" inputMode="decimal" value={v} step={step} onChange={(e) => set(Number(e.target.value))} />
      {hint && <span className="small">{hint}</span>}
    </label>
  );
}

function LimitCard({ p, show, units }: { p: Pending; show: number; units?: string }) {
  return (
    <div className="card setup pend">
      <div className="row">
        <div className={`big ${p.dir === "BUY" ? "up" : "down"}`} style={{ fontSize: 18 }}>{p.strategy}: {p.dir} LIMIT</div>
        <span className="tag">FORMING</span>
      </div>
      <div className="small">Entry {p.entry.toFixed(show)} | SL {p.sl.toFixed(show)} | TP {p.tp.toFixed(show)} | RR {p.rr}</div>
      <div className="small">Price is {p.dist} pips from the entry{units ? ` | ${units}` : ""}</div>
      <ul className="small">{p.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}

function ChangeBox({ c, f, show }: { c: NonNullable<Filled["change"]>; f: Filled; show: number }) {
  return (
    <div className={`chg ${c.level}`} role="alert">
      <div className="row">
        <span className="act">ORDER CHANGE: {ACTION_TEXT[c.action]}</span>
        <span className={`tag ${c.level === "DANGER" ? "r" : ""}`}>{c.level}</span>
      </div>
      <div className="why">Warning: {c.reason}</div>
      <div className="nums">
        {c.sl !== undefined && <>Stop loss <b>{f.sl.toFixed(show)}</b> to <b>{c.sl.toFixed(show)}</b>. </>}
        {c.tp !== undefined && <>Take profit <b>{f.tp.toFixed(show)}</b> to <b>{c.tp.toFixed(show)}</b>. </>}
        {c.action === "CLOSE_EARLY" && <>Close the trade now instead of waiting for the stop at <b>{f.sl.toFixed(show)}</b>.</>}
      </div>
    </div>
  );
}

// A running trade: progress toward the target, floating result, and the automatic order change when it is failing
function PositionCard({ f, show, pip, px, tf }: { f: Filled; show: number; pip: number; px?: number; tf?: string }) {
  const buy = f.dir === "BUY";
  const t = new Date(f.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const live = px ? Number((((buy ? px - f.entry : f.entry - px)) / pip).toFixed(1)) : f.pnl;
  const toTp = px ? Math.max(0, Number((Math.abs(f.tp - px) / pip).toFixed(1))) : null;
  const toSl = px ? Math.max(0, Number((Math.abs(px - f.sl) / pip).toFixed(1))) : null;
  return (
    <div className={`pos ${buy ? "buy" : "sell"} ${f.change ? "chg" : ""}`}>
      <div className="row">
        <div className={`big ${buy ? "up" : "down"}`} style={{ fontSize: 18, marginTop: 0 }}>{tf ? `${tf} ` : ""}{f.strategy}: {f.dir}</div>
        <span className="tag g">RUNNING</span>
      </div>
      <div className="bar" aria-label={`${f.prog}% of the way to the target`}><i style={{ width: `${f.prog}%` }} /></div>
      <div className="stats">
        <span>Best progress <b>{f.prog}%</b></span>
        <span className={live >= 0 ? "up" : "down"}>Floating <b>{live >= 0 ? "+" : ""}{live} pips</b></span>
        {toTp !== null && <span>To TP <b>{toTp}</b></span>}
        {toSl !== null && <span>To SL <b>{toSl}</b></span>}
        <span>Since <b>{t}</b> ({f.bars} candles)</span>
      </div>
      <div className="small" style={{ marginTop: 0 }}>Entry {f.entry.toFixed(show)} | SL {f.sl.toFixed(show)} | TP {f.tp.toFixed(show)} | RR {f.rr}</div>
      {f.change ? <ChangeBox c={f.change} f={f} show={show} /> : <div className="small" style={{ marginTop: 0 }}>On track. The bot is watching it and will propose an order change with a warning if it fails to reach the target.</div>}
    </div>
  );
}

export default function Scanner() {
  const [tab, setTab] = useState<"bot" | "pred">("bot");
  const [pair, setPair] = useState("XAU_USD");
  const [tfId, setTfId] = useState("M15");
  const [sc, setSc] = useState<Scan | null>(null);
  const [fail, setFail] = useState(false);
  const [px, setPx] = useState<Px | null>(null);
  const [tick, setTick] = useState<"up" | "down" | "">("");
  const [alertsOn, setAlertsOn] = useState(false);
  const [st, setSt] = useState<BotSettings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [showSet, setShowSet] = useState(false);
  const [bot, setBot] = useState<Bot | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [voiceName, setVoiceName] = useState("");
  const [music, setMusic] = useState(false);
  const [storeOk, setStoreOk] = useState(true); // false when this browser blocks saving (for example private mode)
  const [theme, setTheme] = useState<(typeof THEMES)[number]["id"]>("noir");
  const prevKeys = useRef<Set<string>>(new Set()); // what the selected timeframe showed on the last scan
  const voiceCtx = useRef("");                     // pair + timeframe + switch the voice last looked at
  const scFor = useRef("");
  const stRef = useRef(st);
  const sentRef = useRef<string[]>([]);
  const running = useRef(false);
  const lastPx = useRef(0);
  stRef.current = st;
  const ins = instOf(pair)!, tf = tfOf(tfId), th = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const set = (patch: Partial<BotSettings>) => setSt((s) => clean({ ...s, ...patch }));

  // Load and save the settings in this browser
  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) setSt(clean(JSON.parse(raw))); } catch {}
    try { sentRef.current = JSON.parse(localStorage.getItem(SENT) ?? "[]"); } catch {}
    try { const t = localStorage.getItem(THEME_KEY); if (THEMES.some((x) => x.id === t)) setTheme(t as (typeof THEMES)[number]["id"]); } catch {}
    try { localStorage.setItem("kitibwa.check", "1"); localStorage.removeItem("kitibwa.check"); } catch { setStoreOk(false); }
    setReady(true);
  }, []);
  useEffect(() => {
    let want = false; try { want = localStorage.getItem(MUSIC_KEY) === "1"; } catch {}
    if (!want) return;
    setMusic(true);
    const go = () => { let still = false; try { still = localStorage.getItem(MUSIC_KEY) === "1"; } catch {} if (still) startAmbient(); window.removeEventListener("pointerdown", go); };
    window.addEventListener("pointerdown", go);
    return () => window.removeEventListener("pointerdown", go);
  }, []);
  useEffect(() => () => stopAmbient(), []);
  const toggleMusic = () => {
    const next = !music;
    setMusic(next);
    try { localStorage.setItem(MUSIC_KEY, next ? "1" : "0"); } catch {}
    if (next) startAmbient(); else stopAmbient();
  };
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme, ready]);
  useEffect(() => { if (ready) try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }, [st, ready]);

  // All timeframes for the selected pair, refreshed every 15 seconds
  const q = `instrument=${pair}&st=${st.strategies.join(",")}&rr=${st.minRR}&sess=${st.sessionFilter ? 1 : 0}`;
  useEffect(() => {
    let live = true;
    const go = () =>
      fetch(`/api/scan?${q}`, { cache: "no-store" })
        .then((x) => (x.ok ? x.json() : Promise.reject()))
        .then((j) => { if (live) { scFor.current = pair; setSc(j); setFail(false); } })
        .catch(() => { if (live) setFail(true); });
    go();
    const id = setInterval(go, 15000);
    return () => { live = false; clearInterval(id); };
  }, [q, pair]);
  useEffect(() => { setSc(null); setPx(null); lastPx.current = 0; }, [pair]);

  // Live price every 3 seconds
  useEffect(() => {
    let live = true;
    const go = () =>
      fetch(`/api/price?instrument=${pair}`, { cache: "no-store" })
        .then((x) => (x.ok ? x.json() : Promise.reject()))
        .then((j: Px) => {
          if (!live) return;
          if (lastPx.current) setTick(j.mid > lastPx.current ? "up" : j.mid < lastPx.current ? "down" : "");
          lastPx.current = j.mid; setPx(j);
        })
        .catch(() => {});
    go();
    const id = setInterval(go, 3000);
    return () => { live = false; clearInterval(id); };
  }, [pair]);

  // Voice / sound / notification: ONLY for the timeframe selected on the dashboard.
  // Each alert is spoken once when it first appears on that timeframe. Switching pair or timeframe, or turning alerts on,
  // starts from what is already on the screen and stays silent about it, so only new events are read out.
  useEffect(() => {
    if (!sc || scFor.current !== pair) return;
    const r = sc.results[tfId];
    if (!r) return;
    type Ev = { key: string; say: string; msg: string; title: string; warn?: boolean };
    const evs: Ev[] = [];
    const pair_ = SAY_PAIR[pair] ?? ins.label, tf_ = SAY_TF[tfId] ?? tfId, demo = sc.demo ? "Demo signal. " : "";
    const f = (n: number) => n.toFixed(ins.show);
    const add = (s: Setup, kind: "M" | "L" | "C") => {
      const dir = s.dir.toLowerCase(), strat = SAY_STRAT[s.strategy] ?? s.strategy;
      const head = kind === "C" ? "Limit order confirmed. Price reached the entry." : kind === "L" ? "Limit order forming." : "New signal.";
      evs.push({
        key: `${kind}|${s.strategy}|${s.dir}`,
        say: `${sc.demo ? "Demo signal. " : ""}${head} ${pair_}, ${tf_} chart. ${dir}, ${strat}. Entry, ${num(s.entry, ins.show)}. Stop loss, ${num(s.sl, ins.show)}. Take profit, ${num(s.tp, ins.show)}.`,
        msg: `${demo}${kind === "C" ? "Limit order CONFIRMED. " : kind === "L" ? "Limit order forming. " : "New signal. "}${ins.label} ${tfId}, ${s.dir}, ${s.strategy}. Entry ${f(s.entry)}, stop loss ${f(s.sl)}, take profit ${f(s.tp)}, risk to reward ${s.rr}.`,
        title: `${ins.label} ${tfId} ${s.dir}${kind === "C" ? " CONFIRMED" : kind === "L" ? " LIMIT" : ""}`,
      });
    };
    r.setups.forEach((s) => add(s, "M"));
    r.pending.forEach((s) => add(s, "L"));
    (r.filled ?? []).forEach((s) => add(s, "C"));
    for (const x of r.filled ?? []) {
      const c = x.change;
      if (!c) continue;
      evs.push({
        key: `CHG|${x.strategy}|${x.dir}|${c.action}`, warn: true,
        say: `Order change. Warning. ${pair_}, ${tf_} chart. ${x.dir.toLowerCase()} ${SAY_STRAT[x.strategy] ?? x.strategy} is failing to reach its target. ${c.reason.replace(/%/g, " percent")} Action: ${ACTION_TEXT[c.action]}.${c.sl !== undefined ? ` New stop loss, ${num(c.sl, ins.show)}.` : ""}${c.tp !== undefined ? ` New take profit, ${num(c.tp, ins.show)}.` : ""}`,
        msg: `ORDER CHANGE (${c.level}). ${ins.label} ${tfId} ${x.dir} ${x.strategy}: ${c.reason} Action: ${ACTION_TEXT[c.action]}.${c.sl !== undefined ? ` New SL ${f(c.sl)}.` : ""}${c.tp !== undefined ? ` New TP ${f(c.tp)}.` : ""}`,
        title: `${ins.label} ${tfId} ORDER CHANGE`,
      });
    }
    const now = new Set(evs.map((e) => e.key));
    const ctx = `${pair}|${tfId}|${alertsOn}`;
    if (voiceCtx.current !== ctx || !alertsOn) { voiceCtx.current = ctx; prevKeys.current = now; return; } // silent baseline
    const fresh = evs.filter((e) => !prevKeys.current.has(e.key));
    prevKeys.current = now; // an alert that disappears can alert again later when it comes back
    if (!fresh.length) return;
    fresh.sort((x, y) => Number(!!y.warn) - Number(!!x.warn)); // order-change warnings first
    const spoken = fresh.slice(0, 2), more = fresh.length - spoken.length;
    if (fresh.some((e) => e.warn)) beepWarn(); else beep();
    spoken.forEach((e, i) => speak(i === spoken.length - 1 && more > 0 ? `${e.say} ${more} more alert${more > 1 ? "s" : ""} on this chart.` : e.say, true));
    fresh.slice(0, 3).forEach((e) => notify(e.title, e.msg));
  }, [sc, alertsOn, pair, tfId, ins]);

  const sayNow = useCallback((t: string) => speak(t), []);
  const toggleAlerts = () => {
    const next = !alertsOn;
    setAlertsOn(next);
    if (next) {
      beep(); speak(`Online Kitibwa voice alerts are on. Reading the ${SAY_TF[tfId] ?? tfId} chart only.`);
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    } else if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  // Alerts. The bot runs while this page is open: every 30 seconds it asks the server to scan and send alerts for NEW setups.
  const runBot = useCallback(async () => {
    const s = stRef.current;
    if (running.current || !s.secret) return;
    running.current = true; setBusy(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST", headers: { "Content-Type": "application/json", "x-bot-secret": s.secret }, body: JSON.stringify({ settings: s, sent: sentRef.current }),
      });
      const j = (await res.json().catch(() => ({}))) as Partial<Bot>;
      if (j.keys?.length) {
        sentRef.current = [...sentRef.current, ...j.keys].slice(-600);
        try { localStorage.setItem(SENT, JSON.stringify(sentRef.current)); } catch {}
      }
      setBot({ at: new Date(), status: res.status, ...j });
    } catch { setBot({ at: new Date(), status: 0, error: "Could not reach the bot. Retrying." }); }
    finally { running.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    if (!ready || !st.enabled) return;
    runBot();
    const id = setInterval(runBot, 30000);
    return () => clearInterval(id);
  }, [ready, st.enabled, runBot]);

  // Every person who opens this page has their own IDs. They live only in this browser and are never stored on the server.
  const clearIds = () => {
    if (!window.confirm("Remove your Telegram, WhatsApp and webhook details from this browser?\n\nAlerts will switch off. Other people's browsers are not affected.")) return;
    set({ enabled: false, telegramToken: "", telegramChat: "", whatsappPhone: "", whatsappKey: "", webhookUrl: "", webhookSecret: "" });
    setTestMsg("Your alert IDs were removed from this browser.");
  };
  const tgOk = !!(st.telegramToken && st.telegramChat), waOk = !!(st.whatsappPhone && st.whatsappKey), whOk = !!st.webhookUrl;
  const tgHalf = !tgOk && !!(st.telegramToken || st.telegramChat), waHalf = !waOk && !!(st.whatsappPhone || st.whatsappKey);
  const hasChannel = !!((st.telegramToken && st.telegramChat) || (st.whatsappPhone && st.whatsappKey) || st.webhookUrl);

  const sendTest = async () => {
    setTestMsg("");
    if (!st.secret) { setTestMsg("Enter the bot password first. It is the BOT_SECRET you set in Cloudflare."); return; }
    if (!hasChannel) { setTestMsg("Fill in Telegram, WhatsApp or the webhook first."); return; }
    setTestMsg("Sending...");
    try {
      const res = await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json", "x-bot-secret": st.secret }, body: JSON.stringify({ settings: st, test: true }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string; channels?: { channel: string; ok: boolean; reason?: string }[] };
      if (!res.ok) { setTestMsg(j.error ?? "The test failed."); return; }
      setTestMsg((j.channels ?? []).map((c) => (c.ok ? `${c.channel}: sent` : `${c.channel}: FAILED (${c.reason ?? "unknown"})`)).join(" | "));
    } catch { setTestMsg("Could not reach the server."); }
  };

  const toggleBot = () => {
    setMsg("");
    if (st.enabled) { set({ enabled: false }); return; }
    if (!st.secret) { setShowSet(true); setMsg("Enter the bot password first. It is the BOT_SECRET you set in Cloudflare."); return; }
    if (!hasChannel) { setShowSet(true); setMsg("Fill in Telegram, WhatsApp or the webhook first, then send a test."); return; }
    if (!st.pairs.length || !st.timeframes.length || !st.strategies.length) { setShowSet(true); setMsg("Pick at least one pair, one timeframe and one strategy."); return; }
    if (window.confirm("Switch alerts ON?\n\nWhile this page is open, the bot will send every new setup to your Telegram / WhatsApp / webhook.")) set({ enabled: true });
  };

  const r = sc?.results[tfId];
  const act = r?.decision.action;
  const cls = act === "BUY" ? "up" : act === "SELL" ? "down" : "";
  const units = (id: string) => (id === "XAU_USD" ? `${st.unitsXau} oz` : id === "BTC_USD" ? `${st.unitsBtc} BTC` : `${st.units} units`);
  const failed = bot?.results?.filter((x) => x.ok === false).length ?? 0;

  const positions = r?.filled ?? [];
  const changes = positions.filter((x) => x.change).length;
  const otherFilled = sc ? Object.entries(sc.results).filter(([t]) => t !== tfId).flatMap(([t, x]) => (x.filled ?? []).map((f) => ({ t, f }))) : [];
  const totalOpen = positions.length + otherFilled.length;
  const totalChanges = changes + otherFilled.filter((x) => x.f.change).length;
  // Live watch for the AI assistant: the bot's own check says a running trade should be closed
  const watchList: Watch[] = positions.filter((x) => x.change?.action === "CLOSE_EARLY").map((x) => ({
    key: `${pair}|${tfId}|${x.strategy}|${x.dir}|${x.since}`,
    text: `${ins.label} ${tfId} ${x.dir} ${x.strategy}: close the trade early. ${x.change!.reason}`,
  }));
  const sessionTxt = r ? (r.closed ? "CLOSED" : !r.sessionOn ? "ANY TIME" : r.inSession ? "ACTIVE" : "OUT") : "...";

  return (
    <div className="dash">
      {/* HEADER: logo, colour design picker, alerts switch */}
      <div className={`card hdr full ${st.enabled ? "armed" : ""}`}>
        <div className="hdrtop">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="ONLINE KITIBWA" className="logo" />
          <div className="hdrright">
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Design: {th.name}</div>
              <div className="themes" role="radiogroup" aria-label="Colour design">
                {THEMES.map((t) => (
                  <button key={t.id} role="radio" aria-checked={t.id === theme} aria-label={t.name} title={t.name} className={`sw ${t.id} ${t.id === theme ? "on" : ""}`} onClick={() => setTheme(t.id)} />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="hdrbar">
          <div className="switchrow">
            <button role="switch" aria-checked={st.enabled} aria-label="Alerts" className={`switch ${st.enabled ? "on" : ""}`} onClick={toggleBot}><span /></button>
            <div>
              <div className="label">Alerts to Telegram / WhatsApp / webhook</div>
              <div className={`big sm ${st.enabled ? "up" : ""}`}>{st.enabled ? (busy ? "ON, scanning..." : "ON") : "OFF"}</div>
            </div>
          </div>
          <div className="small grow" style={{ marginTop: 0 }}>
            {st.enabled
              ? `Bot is watching ${st.pairs.length} pair(s) on ${st.timeframes.length} timeframe(s)${bot ? `, last run ${clock(bot.at)}` : ""}. Keep this page open.`
              : "Switch on to let the bot send every new setup and every order change to your channels. The bot never places orders itself."}
          </div>
          <div className="chips">
            <button className={`chip ${showSet ? "on" : ""}`} onClick={() => setShowSet(!showSet)}>Bot settings</button>
            {st.enabled && <button className="chip" onClick={runBot} disabled={busy}>Run now</button>}
          </div>
          {msg && <div className="warn full" style={{ width: "100%" }}>{msg}</div>}
        </div>
      </div>

      {/* BOT SETTINGS */}
      {showSet && (
        <div className="card full settings">
          <div className="label">Bot settings (saved in this browser)</div>
          <div className="label">Where to send alerts: your own IDs</div>
          <div className="warn">
            Type your own Telegram, WhatsApp or webhook details here. They are saved only in this browser on this device, never on the server and never shared.
            Anyone else who opens this link types their own, so each person&apos;s alerts go only to them. You also need the bot password from the person who set up the bot.
          </div>
          {!storeOk && <div className="error">This browser is not allowing saving (private mode?). Your IDs will be lost when you close the page. Use a normal browser window.</div>}
          <div className="chips wrapchips" aria-label="Your alert channels in this browser">
            <span className={`tag ${tgOk ? "g" : tgHalf ? "r" : ""}`}>Telegram: {tgOk ? "ready" : tgHalf ? "needs token and chat ID" : "not set"}</span>
            <span className={`tag ${waOk ? "g" : waHalf ? "r" : ""}`}>WhatsApp: {waOk ? "ready" : waHalf ? "needs number and key" : "not set"}</span>
            <span className={`tag ${whOk ? "g" : ""}`}>Webhook: {whOk ? "ready" : "not set"}</span>
            <span className={`tag ${st.secret ? "g" : "r"}`}>Bot password: {st.secret ? "saved" : "missing"}</span>
          </div>
          <div className="fields">
            <label className="field">
              <span className="label">Telegram bot token</span>
              <input type="password" autoComplete="off" value={st.telegramToken} onChange={(e) => set({ telegramToken: e.target.value })} placeholder="123456:ABC..." />
              <span className="small">Your own bot: message @BotFather, send /newbot, copy the token</span>
            </label>
            <label className="field">
              <span className="label">Telegram chat ID</span>
              <input autoComplete="off" value={st.telegramChat} onChange={(e) => set({ telegramChat: e.target.value })} placeholder="123456789" />
              <span className="small">Your own ID: press Start on your bot, then get your number from @userinfobot</span>
            </label>
            <label className="field">
              <span className="label">WhatsApp number</span>
              <input autoComplete="off" value={st.whatsappPhone} onChange={(e) => set({ whatsappPhone: e.target.value })} placeholder="9715xxxxxxxx" />
              <span className="small">Your own number, with country code, digits only</span>
            </label>
            <label className="field">
              <span className="label">WhatsApp API key (CallMeBot)</span>
              <input type="password" autoComplete="off" value={st.whatsappKey} onChange={(e) => set({ whatsappKey: e.target.value })} placeholder="from CallMeBot" />
              <span className="small">Free key from callmebot.com, made for your own number</span>
            </label>
            <label className="field">
              <span className="label">Webhook URL (execution)</span>
              <input autoComplete="off" value={st.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} placeholder="https://..." />
              <span className="small">The bot POSTs each setup here. Must be https.</span>
            </label>
            <label className="field">
              <span className="label">Webhook secret (optional)</span>
              <input type="password" autoComplete="off" value={st.webhookSecret} onChange={(e) => set({ webhookSecret: e.target.value })} />
              <span className="small">Sent as header x-webhook-secret</span>
            </label>
          </div>
          <div className="chips wrapchips">
            <button type="button" className="chip on" onClick={sendTest}>Send test alert</button>
            <button type="button" className="chip" onClick={clearIds}>Remove my IDs from this browser</button>
          </div>
          {testMsg && <div className="small">{testMsg}</div>}
          <Multi label="Pairs the bot watches" all={INSTRUMENTS.map((i) => ({ id: i.id, label: i.label }))} on={st.pairs} set={(pairs) => set({ pairs })} />
          <Multi label="Timeframes the bot scans" all={TIMEFRAMES.map((t) => ({ id: t.id, label: t.id }))} on={st.timeframes} set={(timeframes) => set({ timeframes })} />
          <Multi label="Strategies" all={STRATEGIES.map((s) => ({ id: s, label: s }))} on={st.strategies} set={(strategies) => set({ strategies })} />
          <div className="chips wrapchips">
            <button className={`chip ${st.useLimit ? "on" : ""}`} aria-pressed={st.useLimit} onClick={() => set({ useLimit: !st.useLimit })}>Alert on limit orders when structure is forming: {st.useLimit ? "ON" : "OFF"}</button>
            <button className={`chip ${st.sessionFilter ? "on" : ""}`} aria-pressed={st.sessionFilter} onClick={() => set({ sessionFilter: !st.sessionFilter })}>London / New York filter (not used for Bitcoin): {st.sessionFilter ? "ON" : "OFF"}</button>
            <button className={`chip ${st.newsFilter ? "on" : ""}`} aria-pressed={st.newsFilter} onClick={() => set({ newsFilter: !st.newsFilter })}>News filter: {st.newsFilter ? "ON" : "OFF"}</button>
            <button className={`chip ${st.newsImpact === "medium" ? "on" : ""}`} aria-pressed={st.newsImpact === "medium"} onClick={() => set({ newsImpact: st.newsImpact === "medium" ? "high" : "medium" })}>News impact: {st.newsImpact === "medium" ? "HIGH + MEDIUM" : "HIGH ONLY"}</button>
          </div>
          <div className="fields">
            <Num label="Size sent to webhook (units)" v={st.units} set={(units) => set({ units })} step={100} hint="Forex pairs" />
            <Num label="Gold size sent to webhook (oz)" v={st.unitsXau} set={(unitsXau) => set({ unitsXau })} hint="XAU/USD" />
            <Num label="Bitcoin size sent to webhook (BTC)" v={st.unitsBtc} set={(unitsBtc) => set({ unitsBtc })} step={0.01} hint="BTC/USD, 0.0001 to 100" />
            <Num label="Min risk:reward" v={st.minRR} set={(minRR) => set({ minRR })} step={0.1} hint="1 to 10" />
            <Num label="Limit order expiry (h)" v={st.limitHours} set={(limitHours) => set({ limitHours })} hint="Sent with the webhook" />
            <Num label="News filter: minutes before" v={st.newsBefore} set={(newsBefore) => set({ newsBefore })} hint="0 to 240" />
            <Num label="News filter: minutes after" v={st.newsAfter} set={(newsAfter) => set({ newsAfter })} hint="0 to 240" />
            <label className="field">
              <span className="label">Bot password</span>
              <input type="password" autoComplete="off" value={st.secret} onChange={(e) => set({ secret: e.target.value })} placeholder="BOT_SECRET" />
              <span className="small">Same value as BOT_SECRET in Cloudflare</span>
            </label>
          </div>
          <div className="chips"><button className="chip" onClick={() => setSt({ ...DEFAULTS, secret: st.secret, telegramToken: st.telegramToken, telegramChat: st.telegramChat, whatsappPhone: st.whatsappPhone, whatsappKey: st.whatsappKey, webhookUrl: st.webhookUrl, webhookSecret: st.webhookSecret })}>Reset to defaults</button></div>
        </div>
      )}

      {/* PAIR + VOICE */}
      <div className="picker full">
        <div className="chips" role="tablist" aria-label="Pair">
          {INSTRUMENTS.map((p) => (
            <button key={p.id} onClick={() => setPair(p.id)} className={`chip ${p.id === pair ? "on" : ""}`} aria-pressed={p.id === pair}>{p.label}</button>
          ))}
        </div>
        <div className="chips">
          <button onClick={toggleAlerts} className={`chip ${alertsOn ? "on" : ""}`} aria-pressed={alertsOn} title="Voice and sound alerts read only the timeframe selected below">{alertsOn ? `Voice ${tfId}: ON` : `Voice ${tfId}: OFF`}</button>
          <button onClick={toggleMusic} className={`chip ${music ? "on" : ""}`} aria-pressed={music} title="Soft background melodies. They fade down while the assistant speaks.">{music ? "Soft music: ON" : "Soft music: OFF"}</button>
          <button onClick={() => { const n = nextVoice(); speak("Welcome to Kitibwa, your AI trading assistant."); setVoiceName(n); }} className="chip" title="Cycle through the lady voices on this device">{voiceName ? `Voice: ${voiceName.replace(/^(Microsoft|Google)\s+/i, "").split(" ")[0]}` : "Change voice"}</button>
          <button onClick={() => { beep(); speak("Test signal. Gold, 5 minute chart. buy setup, C R T. Entry, 4139 point 4 0. This is only a test."); }} className="chip">Test sound</button>
        </div>
      </div>

      {/* KPI STRIP */}
      <div className="kpis full">
        <div className="card kpi pricek">
          <div className="label"><span className={`dot ${fail ? "bad" : ""}`} /> {fail ? "Reconnecting" : px?.demo ? "Not live" : "Live"} | {ins.label}</div>
          {px?.demo ? (
            <>
              <div className="big price" style={{ fontSize: 22, color: "var(--muted)" }}>NO LIVE PRICE</div>
              <div className="warn">The bot is on simulated data, so it has no real price. Use the TradingView chart for the real price. The bot needs a live price feed before it can send alerts.</div>
            </>
          ) : (
            <>
              <div className={`big price ${tick}`}>{px ? px.mid.toFixed(ins.show) : "..."}</div>
              {px && <div className="small" style={{ marginTop: 2 }}>Bid {px.bid.toFixed(ins.show)} | Ask {px.ask.toFixed(ins.show)} | live from Yahoo Finance</div>}
            </>
          )}
        </div>
        <div className={`card kpi ${act === "BUY" ? "buy" : act === "SELL" ? "sell" : ""}`}>
          <div className="label">Decision | {tfId}</div>
          <div className={`big ${cls}`}>{act ?? "..."}</div>
          <div className="small" style={{ marginTop: 2 }}>{r?.decision.why ?? "Scanning..."}</div>
        </div>
        <div className="card kpi">
          <div className="label">{r?.htf ?? tf.htf} bias</div>
          <div className="big">{r ? (r.bias ?? "NONE") : "..."}</div>
        </div>
        <div className="card kpi half">
          <div className="label">Session</div>
          <div className="big">{sessionTxt}</div>
          <div className="small" style={{ marginTop: 2 }}>{ins.crypto ? "Bitcoin trades 24/7" : r?.sessionOn ? "London / New York (UTC)" : "Filter off above H1"}</div>
        </div>
        <div className={`card kpi half ${totalChanges ? "sell" : totalOpen ? "buy" : ""}`}>
          <div className="label">Running trades</div>
          <div className="big">{totalOpen}</div>
          <div className={`small ${totalChanges ? "down" : ""}`} style={{ marginTop: 2 }}>{totalChanges ? `${totalChanges} order change${totalChanges > 1 ? "s" : ""} proposed` : totalOpen ? "All on track" : "No trade running"}</div>
        </div>
      </div>

      {/* TIMEFRAMES */}
      <div className="card full">
        <div className="row">
          <div className="label">All timeframes scanned together | tap one to select it (voice reads only the selected one)</div>
          <div className="small right" style={{ marginTop: 0 }}>{sc ? `Updated ${clock(sc.at)}` : "Scanning..."}, every 15s</div>
        </div>
        <div className="tfgrid">
          {TIMEFRAMES.map((t) => {
            const x = sc?.results[t.id], a = x?.decision.action ?? "...", n = x?.pending.length ?? 0, nf = x?.filled?.length ?? 0;
            const warnN = (x?.filled ?? []).filter((y) => y.change).length;
            return (
              <button key={t.id} onClick={() => setTfId(t.id)} className={`tile ${t.id === tfId ? "on" : ""}`} aria-pressed={t.id === tfId}>
                <span className="tfname"><span className={`dot ${fail ? "bad" : ""}`} />{t.id}</span>
                <span className={`tact ${a === "BUY" ? "up" : a === "SELL" ? "down" : ""}`}>{a}</span>
                <span className="small" style={{ marginTop: 0 }}>{x ? `bias ${x.bias ?? "none"}` : ""}</span>
                {warnN > 0 && <span className="tag r">{warnN} CHANGE</span>}
                {nf > 0 && <span className="tag g">{nf} RUNNING</span>}
                {n > 0 && <span className="tag">{n} LIMIT</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="chips full" role="tablist" aria-label="View">
        <button role="tab" aria-selected={tab === "bot"} onClick={() => setTab("bot")} className={`chip ${tab === "bot" ? "on" : ""}`}>Dashboard</button>
        <button role="tab" aria-selected={tab === "pred"} onClick={() => setTab("pred")} className={`chip ${tab === "pred" ? "on" : ""}`}>Prediction</button>
      </div>

      {tab === "pred" && (
        <div className="full">
          <NewsPredict pair={pair} tfId={tfId} setTf={setTfId} show={ins.show} st={st} setNewsFilter={(v) => set({ newsFilter: v })} />
        </div>
      )}

      {tab === "bot" && (
        <>
          {/* CHART */}
          <div className="card chartcard">
            <div className="chartbar">
              <div className="label">{ins.label} | {tf.id} chart</div>
              <div className="small" style={{ marginTop: 0 }}>Bias {tf.htf} | confirmation {tf.ltf}</div>
            </div>
            <TradingViewChart symbol={ins.tv} interval={tf.tv} bg={th.bg} grid={th.grid} />
          </div>

          <div className="side">
            {/* RUNNING TRADES + AUTOMATIC ORDER CHANGES */}
            <div className="card panel">
              <div className="ptitle"><div className="label">Running trades | {tf.id}</div>{positions.length > 0 && <span className="count">{positions.length}</span>}</div>
              {fail && <div className="error">Could not reach the scanner. Retrying.</div>}
              {!r && !fail && <div className="small">Scanning...</div>}
              {sc?.error && <div className="error">{sc.error}</div>}
              {sc?.demo && <div className="warn">Bot is on simulated data, so signals are not real and NO alerts are sent. The chart is live, but the bot has no real price feed yet.</div>}
              {r && positions.length === 0 && <div className="small">No trade is running on {tf.id}. When a limit order is reached it appears here, and the bot manages it automatically: if it fails to reach the target, it proposes an order change with a warning reason.</div>}
              {positions.map((f, i) => <PositionCard key={`p${i}`} f={f} show={ins.show} pip={ins.pip} px={px && !px.demo ? px.mid : undefined} />)}
              {otherFilled.length > 0 && <div className="label" style={{ marginTop: 16 }}>Also running on other timeframes</div>}
              {otherFilled.map(({ t, f }, i) => (
                <button key={`o${t}${i}`} className="pendbtn" style={{ background: "none", border: 0, padding: 0 }} onClick={() => setTfId(t)}>
                  <PositionCard f={f} show={ins.show} pip={ins.pip} px={px && !px.demo ? px.mid : undefined} tf={t} />
                </button>
              ))}
            </div>

            {/* LIVE SETUPS + FORMING LIMIT ORDERS */}
            <div className="card panel">
              <div className="label">KITIBWA bot: CRT + CISD + MSNR/LIT | {tf.id}</div>
              {!r && <div className="small">Scanning...</div>}
              {r && r.setups.length === 0 && <div className="small">No live market setup on {tf.id} right now.</div>}
              {r?.setups.map((s, i) => (
                <div key={i} className="card setup">
                  <div className={`big ${s.dir === "BUY" ? "up" : "down"}`} style={{ fontSize: 20, marginTop: 0 }}>{s.strategy}: {s.dir}</div>
                  <div className="small">Entry {s.entry.toFixed(ins.show)} | SL {s.sl.toFixed(ins.show)} | TP {s.tp.toFixed(ins.show)} | RR {s.rr}</div>
                  <ul className="small">{s.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ))}
              {r && (
                <>
                  <div className="label" style={{ marginTop: 16 }}>Limit orders forming</div>
                  {r.pending.length === 0 && <div className="small">No structure forming on {tf.id} right now.</div>}
                  {r.pending.map((p, i) => <LimitCard key={i} p={p} show={ins.show} units={units(ins.id)} />)}
                </>
              )}
            </div>

            {/* Limit orders forming on the other timeframes */}
            {sc && Object.entries(sc.results).some(([t, x]) => t !== tfId && x.pending.length > 0) && (
              <div className="card panel">
                <div className="label">Also forming on other timeframes</div>
                {Object.entries(sc.results).filter(([t]) => t !== tfId).flatMap(([t, x]) =>
                  x.pending.map((p, i) => (
                    <button key={`${t}${i}`} className="card setup pendbtn" onClick={() => setTfId(t)}>
                      <span className={`${p.dir === "BUY" ? "up" : "down"}`}><b>{t}</b> {p.strategy} {p.dir} LIMIT</span>
                      <span className="small">Entry {p.entry.toFixed(ins.show)} | SL {p.sl.toFixed(ins.show)} | TP {p.tp.toFixed(ins.show)} | RR {p.rr}</span>
                    </button>
                  ))
                )}
              </div>
            )}

        {/* Bot activity */}
        {bot && (
          <div className="card panel">
            <div className="label">Bot activity</div>
            <div className="small">Last run {clock(bot.at)}{failed ? ` | ${failed} alert(s) failed` : ""}</div>
            {bot.error && <div className="error">{bot.error}</div>}
            {bot.skipped && <div className="small">{bot.skipped}</div>}
            <ul className="log">
              {bot.results?.map((x, i) => (
                <li key={i} className={x.ok === true ? "up" : x.ok === false ? "down" : "muted"}>
                  {x.skipped
                    ? `${x.instrument}: ${x.skipped}`
                    : `${x.instrument} ${x.tf} ${x.kind} ${x.dir} ${x.strategy} @ ${x.entry} (SL ${x.sl}, TP ${x.tp}): ${x.ok ? `alert sent (${x.sent})` : `failed${x.reason ? ` - ${x.reason}` : ""}`}`}
                </li>
              ))}
            </ul>
          </div>
        )}
          </div>
        </>
      )}

      {/* AI ASSISTANT: one clean floating button, bottom right */}
      <Assistant pair={pair} tfId={tfId} secret={st.secret} openCount={totalOpen} watch={watchList} silentWatch={alertsOn} say={sayNow} warn={beepWarn} />
    </div>
  );
}
