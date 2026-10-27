// Builds the live market picture the AI assistant reads. It sees the same data the bot sees (not the TradingView picture itself).
import { getBundle, frameFor } from "./data";
import { scan } from "./engine";
import { instOf, tfOf } from "./config";
import { fetchPrice } from "./feed";

export async function buildContext(pair: string, tfId: string): Promise<string> {
  const ins = instOf(pair);
  if (!ins) return "Unknown pair.";
  const tf = tfOf(tfId), d = (n: number) => n.toFixed(ins.show);
  const b = await getBundle(pair);
  const f = frameFor(b, tf), r = scan(f, ins, tf);
  let price = "unavailable";
  try { const { p } = await fetchPrice(pair); if (p) price = `bid ${d(p.bid)}, ask ${d(p.ask)}, mid ${d(p.mid)}`; } catch {}
  const row = (c: { t: string; o: number; h: number; l: number; c: number }) => `${c.t.slice(5, 16).replace("T", " ")} O${d(c.o)} H${d(c.h)} L${d(c.l)} C${d(c.c)}`;
  const set = (s: { strategy: string; dir: string; entry: number; sl: number; tp: number; rr: number }) => `${s.strategy} ${s.dir} entry ${d(s.entry)} SL ${d(s.sl)} TP ${d(s.tp)} RR ${s.rr}`;
  const lines = [
    `Time (UTC): ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    `Pair: ${ins.label} | selected timeframe: ${tf.id} (bias frame ${tf.htf}, confirmation frame ${tf.ltf}) | 1 pip = ${ins.pip}`,
    `Price now: ${price}${b.demo ? " (WARNING: the bot is on simulated data, so nothing here is real)" : ""}`,
    `Bot decision: ${r.decision.action}. ${r.decision.why}. ${tf.htf} bias: ${r.bias ?? "none"}. Session: ${r.closed ? "market closed" : r.inSession ? "active" : "outside London/New York"}.`,
    `Live setups: ${r.setups.length ? r.setups.map(set).join("; ") : "none"}`,
    `Limit orders forming: ${r.pending.length ? r.pending.map((p) => `${set(p)} (${p.dist} pips away)`).join("; ") : "none"}`,
    `Running trades (limit orders price already reached): ${r.filled.length ? "" : "none"}`,
    ...r.filled.map((x) => `- ${set(x)} | since ${x.since.slice(11, 16)} UTC, ${x.bars} candles | best progress ${x.prog}% of the way to TP | floating ${x.pnl} pips${x.change ? ` | BOT WARNING (${x.change.level}): ${x.change.reason} Proposed: ${x.change.action}${x.change.sl !== undefined ? ` new SL ${d(x.change.sl)}` : ""}${x.change.tp !== undefined ? ` new TP ${d(x.change.tp)}` : ""}` : " | on track"}`),
    `Last 24 ${tf.id} candles (oldest first):`, ...f.m15.slice(-24).map(row),
    `Last 8 ${tf.htf} candles:`, ...f.h4.slice(-8).map(row),
  ];
  return lines.join("\n");
}

export const SYSTEM = (ctx: string) => `You are the AI trading assistant inside the ONLINE KITIBWA dashboard. You talk with the trader and read the live market data below, which is refreshed on every message.
Rules:
- Answer ONLY from the data below and general trading knowledge. If something is not in the data, say so. Never invent prices or news.
- You cannot place, change or close orders. You only advise; the trader acts. Never claim an order was placed.
- Start EVERY reply with one line: VERDICT: CLOSE, VERDICT: HOLD, VERDICT: WAIT or VERDICT: NONE.
  CLOSE = a running trade should be closed now (or its stop moved) and say why. HOLD = a running trade is fine. WAIT = no trade running, no entry yet. NONE = general question.
- After that line give 2 to 5 short plain sentences. Mention exact prices where it helps. Spoken style, no markdown, no lists.
- Be honest about uncertainty. Nothing is guaranteed and this is not financial advice. Do not push the trader to take a trade.

LIVE DATA
${ctx}`;
