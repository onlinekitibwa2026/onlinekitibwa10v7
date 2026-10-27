// Prediction: always leans BUY or SELL, with a confidence score and possible entries.
// It combines the higher-timeframe structure, the trend, the live setups and the forming limit orders from the engine.
import { atr, bias, levels, type C, type Dir, type Filled, type Pending, type Setup } from "./engine";
import type { Inst } from "./config";

export type Entry = { kind: "CONFIRMED" | "MARKET" | "LIMIT" | "PULLBACK"; label: string; dir: Dir; entry: number; sl: number; tp: number; rr: number; pips: number; note: string; state?: "TRIGGERED" | "RUNNING"; since?: string; pnl?: number; toTp?: number; toSl?: number };
export type Prediction = { dir: Dir; confidence: number; score: number; price: number; reasons: string[]; entries: Entry[] };

const sgn = (d: Dir) => (d === "BUY" ? 1 : -1);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ema = (v: number[], n: number) => { const k = 2 / (n + 1); let e = v[0]; for (const x of v) e = x * k + e * (1 - k); return e; };
const r2 = (n: number) => Number(n.toFixed(2));

export function predict(
  d: { h4: C[]; m15: C[]; m1: C[] }, ins: Inst, r: { setups: Setup[]; pending: Pending[]; filled?: Filled[] }, L: { h: string; m: string },
): Prediction | null {
  const m = d.m15;
  if (m.length < 60) return null;
  const px = m[m.length - 1].c, pip = ins.pip;
  let score = 0;
  const reasons: string[] = [];
  const add = (v: number, text: string) => { score += v; reasons.push(`${v > 0 ? "Bullish" : "Bearish"}: ${text}`); };

  const hb = bias(d.h4);
  if (hb) add(2 * sgn(hb), `${L.h} structure is ${hb === "BUY" ? "making higher highs and higher lows" : "making lower highs and lower lows"}`);
  const sb = bias(m);
  if (sb) add(sgn(sb), `${L.m} structure is ${sb === "BUY" ? "rising" : "falling"}`);

  const c = m.slice(-120).map((k) => k.c), e20 = ema(c, 20), e50 = ema(c, 50);
  add(e20 > e50 ? 1 : -1, `${L.m} EMA 20 is ${e20 > e50 ? "above" : "below"} EMA 50`);
  if (d.h4.length >= 50) {
    const h = d.h4.map((k) => k.c);
    add(ema(h, 20) > ema(h, 50) ? 1 : -1, `${L.h} EMA 20 is ${ema(h, 20) > ema(h, 50) ? "above" : "below"} EMA 50`);
  }
  let ls = 0;
  for (const s of r.setups) { ls += 2 * sgn(s.dir); reasons.push(`${s.dir === "BUY" ? "Bullish" : "Bearish"}: ${s.strategy} ${s.dir} setup is live (RR ${s.rr})`); }
  score += clamp(ls, -4, 4);
  let fs = 0;
  for (const f of r.filled ?? []) { fs += 2 * sgn(f.dir); reasons.push(`${f.dir === "BUY" ? "Bullish" : "Bearish"}: ${f.strategy} ${f.dir} limit order is CONFIRMED (price reached the entry)`); }
  score += clamp(fs, -4, 4);
  let ps = 0;
  for (const p of r.pending) { ps += 0.75 * sgn(p.dir); reasons.push(`${p.dir === "BUY" ? "Bullish" : "Bearish"}: ${p.strategy} ${p.dir} limit order is forming`); }
  score += clamp(ps, -1.5, 1.5);
  const back = m[m.length - 11]?.c;
  if (back !== undefined && px !== back) add(px > back ? 0.5 : -0.5, `price is ${px > back ? "higher" : "lower"} than 10 candles ago`);

  const dir: Dir = score > 0 ? "BUY" : score < 0 ? "SELL" : px >= e20 ? "BUY" : "SELL";
  const s = sgn(dir);
  const confidence = Math.round(Math.min(95, 50 + Math.abs(score) * 6.5));
  const entries: Entry[] = [];
  const dist = (e: number) => Number((Math.abs(e - px) / pip).toFixed(1));

  // 0. limit orders that price has reached: confirmed, trade is active until target or stop
  // Every confirmed order is shown (also one against the lean, it is still a live trade). It reads ORDER TRIGGERED on the candle it fills (or the next one), then RUNNING until the target or stop is hit and it is deleted.
  const prevT = m[m.length - 2]?.t;
  for (const x of (r.filled ?? [])) {
    const fresh = prevT !== undefined && Date.parse(x.since) >= Date.parse(prevT);
    const xs = sgn(x.dir), pnl = Number((xs * (px - x.entry) / pip).toFixed(1));
    entries.push({
      kind: "CONFIRMED", label: `${x.strategy} ${x.dir} order ${fresh ? "TRIGGERED" : "RUNNING"}`, dir: x.dir, entry: x.entry, sl: x.sl, tp: x.tp, rr: x.rr, pips: dist(x.entry),
      state: fresh ? "TRIGGERED" : "RUNNING", since: x.since, pnl,
      toTp: Number((Math.max(0, xs * (x.tp - px)) / pip).toFixed(1)), toSl: Number((Math.max(0, xs * (px - x.sl)) / pip).toFixed(1)),
      note: x.dir === dir ? "Price reached the entry. The trade stays open until the target or the stop is hit, then it is deleted" : "Running trade that is against the current prediction. Manage it by its stop and target",
    });
  }
  // 1. live setups that agree with the prediction: enter now
  for (const x of r.setups.filter((y) => y.dir === dir))
    entries.push({ kind: "MARKET", label: `${x.strategy} market entry`, dir, entry: x.entry, sl: x.sl, tp: x.tp, rr: x.rr, pips: dist(x.entry), note: x.reasons.slice(0, 2).join("; ") });
  // 2. forming limit orders that agree: wait for price
  for (const x of r.pending.filter((y) => y.dir === dir))
    entries.push({ kind: "LIMIT", label: `${x.strategy} limit order`, dir, entry: x.entry, sl: x.sl, tp: x.tp, rr: x.rr, pips: dist(x.entry), note: x.reasons.slice(0, 2).join("; ") });

  const a = atr(m, 14);
  if (a > 0) {
    // 3. pullback entry at the nearest support (BUY) or resistance (SELL), stop 1.2 ATR beyond it, target the next level or 2R
    const lv = levels(m.slice(-150));
    const near = (dir === "BUY" ? lv.V : lv.A).filter((v) => s * (px - v) > 0.2 * a && s * (px - v) < 4 * a);
    const entry = near.length ? (dir === "BUY" ? Math.max(...near) : Math.min(...near)) : px - s * 0.6 * a;
    const risk = 1.2 * a, sl = entry - s * risk;
    const far = (dir === "BUY" ? lv.A : lv.V).filter((v) => s * (v - entry) >= 1.5 * risk && s * (v - entry) <= 5 * risk);
    const tp = far.length ? (dir === "BUY" ? Math.min(...far) : Math.max(...far)) : entry + s * 2 * risk;
    entries.push({
      kind: "PULLBACK", label: `${dir === "BUY" ? "Buy" : "Sell"} on pullback`, dir, entry, sl, tp, rr: r2(Math.abs(tp - entry) / risk), pips: dist(entry),
      note: near.length ? `Waits at the nearest ${dir === "BUY" ? "support" : "resistance"} level` : "Waits for a small pullback (0.6 ATR)",
    });
    // 4. no live trigger: a smaller-confidence market entry
    if (!r.setups.some((y) => y.dir === dir) && !(r.filled ?? []).some((y) => y.dir === dir)) {
      const t = px + s * 2.4 * a;
      entries.push({ kind: "MARKET", label: "Market entry (no confirmed trigger)", dir, entry: px, sl: px - s * risk, tp: t, rr: 2, pips: 0, note: "Lower probability: use a smaller size or wait for the pullback entry" });
    }
  }
  return { dir, confidence, score: Number(score.toFixed(1)), price: px, reasons, entries };
}
