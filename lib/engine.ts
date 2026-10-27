import type { Inst, Tf } from "./config";
export type C = { t: string; o: number; h: number; l: number; c: number };
export type Dir = "BUY" | "SELL";
export type Setup = { strategy: string; dir: Dir; entry: number; sl: number; tp: number; rr: number; reasons: string[] };
// A limit order idea: structure is forming but price has not reached the entry yet
export type Pending = Setup & { kind: "LIMIT"; dist: number };
// Automatic position management: when a running trade is not reaching its target, the bot proposes an order change and says why.
export type OrderChange = {
  action: "MOVE_SL_TO_BE" | "TIGHTEN_SL" | "REDUCE_TP" | "CLOSE_EARLY";
  level: "CAUTION" | "WARNING" | "DANGER";
  reason: string;           // the warning shown to the user
  sl?: number;              // new stop loss to set (for MOVE_SL_TO_BE and TIGHTEN_SL)
  tp?: number;              // new take profit to set (for REDUCE_TP)
};
// A limit order that price has reached: CONFIRMED until its target or stop is hit, then it is deleted
export type Filled = Setup & { kind: "CONFIRMED"; since: string; prog: number; bars: number; pnl: number; change?: OrderChange };

const max = (a: number[]) => Math.max(...a);
const min = (a: number[]) => Math.min(...a);
const mirror = (cs: C[]): C[] => cs.map((x) => ({ t: x.t, o: -x.o, h: -x.l, l: -x.h, c: -x.c }));

export const atr = (cs: C[], n = 14) => { const w = cs.slice(-n); return w.reduce((a, k) => a + (k.h - k.l), 0) / Math.max(1, w.length); };

export function swings(cs: C[], n = 2) {
  const hi: number[] = [], lo: number[] = [];
  for (let i = n; i < cs.length - n; i++) {
    const w = cs.slice(i - n, i + n + 1);
    if (cs[i].h === max(w.map((k) => k.h))) hi.push(i);
    if (cs[i].l === min(w.map((k) => k.l))) lo.push(i);
  }
  return { hi, lo };
}

// HTF bias: higher highs + higher lows = BUY, lower highs + lower lows = SELL
export function bias(cs: C[]): Dir | null {
  const s = swings(cs);
  if (s.hi.length < 2 || s.lo.length < 2) return null;
  const [h1, h2] = s.hi.slice(-2).map((i) => cs[i].h);
  const [l1, l2] = s.lo.slice(-2).map((i) => cs[i].l);
  if (h2 > h1 && l2 > l1) return "BUY";
  if (h2 < h1 && l2 < l1) return "SELL";
  return null;
}

// MSNR levels drawn on the line chart (closes): A-level = peak, V-level = trough
export function levels(cs: C[]) {
  const A: number[] = [], V: number[] = [];
  for (let i = 2; i < cs.length - 2; i++) {
    const w = cs.slice(i - 2, i + 3).map((k) => k.c);
    if (cs[i].c === max(w)) A.push(cs[i].c);
    if (cs[i].c === min(w)) V.push(cs[i].c);
  }
  return { A, V };
}

// CISD: close above the open of 2+ consecutive down-close candles (bullish), or the reverse (bearish)
export function cisd(cs: C[]) {
  const i = cs.length - 1;
  if (i < 3) return null;
  const down = (k: number) => cs[k].c < cs[k].o;
  const up = (k: number) => cs[k].c > cs[k].o;
  for (const dir of ["BUY", "SELL"] as const) {
    const inRun = dir === "BUY" ? down : up;
    let j = i - 1;
    while (j >= 0 && inRun(j)) j--;
    const from = j + 1;
    if (i - from < 2) continue;
    const level = cs[from].o;
    if (dir === "BUY" ? cs[i].c <= level : cs[i].c >= level) continue;
    const seg = cs.slice(from, i);
    const ext = dir === "BUY" ? min(seg.map((k) => k.l)) : max(seg.map((k) => k.h));
    return { dir, level, from, ext };
  }
  return null;
}
// CISD from the last 3 candles that price has not already invalidated
const recentCisd = (cs: C[]) => {
  const last = cs[cs.length - 1]?.c;
  return [0, 1, 2].map((k) => cisd(cs.slice(0, cs.length - k))).find((x) => x && (x.dir === "BUY" ? last > x.level : last < x.level)) ?? null;
};

function mk(strategy: string, dir: Dir, entry: number, sl: number, tp: number, reasons: string[]): Setup | null {
  const risk = Math.abs(entry - sl), reward = Math.abs(tp - entry);
  const ok = dir === "BUY" ? sl < entry && tp > entry : sl > entry && tp < entry;
  if (!ok || risk === 0 || reward / risk < 1) return null;
  return { strategy, dir, entry, sl, tp, rr: Number((reward / risk).toFixed(2)), reasons };
}

// Soft Trader CRT: strong H4 candle, next candle sweeps one side and closes back inside, LTF CISD confirms, target = other side
export function crt(h4: C[], m15: C[], pip: number): Setup | null {
  const x = recentCisd(m15);
  if (!x || h4.length < 4) return null;
  const entry = m15[m15.length - 1].c;
  for (const b of [h4.length - 2, h4.length - 3]) {
    const base = h4[b], range = base.h - base.l;
    if (range <= 0 || Math.abs(base.c - base.o) / range < 0.55) continue;
    const after = h4.slice(b + 1);
    const hi = max(after.map((k) => k.h)), lo = min(after.map((k) => k.l));
    const last = after[after.length - 1], mid = (base.h + base.l) / 2;
    if (hi > base.h && lo >= base.l && last.c < base.h && x.dir === "SELL" && entry >= mid)
      return mk("CRT", "SELL", entry, hi + pip, base.l, ["H4 CRT candle swept CRT High and closed back inside", "M15 bearish CISD confirmation", "Target: CRT Low"]);
    if (lo < base.l && hi <= base.h && last.c > base.l && x.dir === "BUY" && entry <= mid)
      return mk("CRT", "BUY", entry, lo - pip, base.h, ["H4 CRT candle swept CRT Low and closed back inside", "M15 bullish CISD confirmation", "Target: CRT High"]);
  }
  return null;
}

// CISD Mastery: CISD in the direction of the H4 bias, after a liquidity sweep
export function cisdSetup(m15: C[], h4: C[], pip: number): Setup | null {
  const x = recentCisd(m15), hb = bias(h4);
  if (!x || x.dir !== hb) return null;
  const pre = m15.slice(Math.max(0, x.from - 20), x.from);
  if (pre.length < 5) return null;
  const swept = x.dir === "BUY" ? x.ext < min(pre.map((k) => k.l)) : x.ext > max(pre.map((k) => k.h));
  if (!swept) return null;
  const entry = m15[m15.length - 1].c, win = m15.slice(-40);
  const why = [`M15 ${x.dir === "BUY" ? "bullish" : "bearish"} CISD`, "Liquidity swept before the CISD", "Aligned with H4 bias"];
  return x.dir === "BUY"
    ? mk("CISD", "BUY", entry, x.ext - pip, max(win.map((k) => k.h)), why)
    : mk("CISD", "SELL", entry, x.ext + pip, min(win.map((k) => k.l)), why);
}

// Alchemist MSNR + LIT (bullish side): BOS, POI, inducement swept (TS), M1 confirmation, SL 10 pips
function litBuy(m15: C[], m1: C[], pip: number, slPips: number): Setup | null {
  const x = recentCisd(m1);
  if (!x || x.dir !== "BUY") return null;
  const s = swings(m15), n = m15.length;
  for (const il of [...s.lo].reverse()) {
    const ph = [...s.hi].reverse().find((i) => i < il);
    if (ph === undefined) continue;
    const level = m15[ph].h;
    const bos = m15.findIndex((k, i) => i > il && k.c > level);
    if (bos < 0) continue;
    const idm = [...s.lo].reverse().find((i) => i > bos);
    if (idm === undefined) continue;
    const idmLvl = m15[idm].l, poiHi = Math.max(m15[il].o, m15[il].c);
    const recent = m15.slice(Math.max(idm + 1, n - 6));
    if (!recent.some((k) => k.l < idmLvl && k.c > idmLvl)) continue;
    if (min(recent.map((k) => k.l)) > poiHi + 3 * pip) continue;
    const entry = m1[m1.length - 1].c;
    const near = levels(m15).V.some((v) => Math.abs(v - entry) <= 8 * pip || Math.abs(v - poiHi) <= 8 * pip);
    return mk("MSNR+LIT", "BUY", entry, entry - slPips * pip, level, [
      "M15 BOS up, price returned to the POI",
      "Inducement swept (TS) and rejected",
      `M1 bullish CISD (MSS) entry, SL ${Math.round(slPips)} pips`,
      near ? "MSNR V-level (support) near entry" : "No MSNR level nearby",
    ]);
  }
  return null;
}
const flip = (t: string) => t.replace("BOS up", "BOS down").replace("bullish", "bearish").replace("V-level (support)", "A-level (resistance)");
export function lit(m15: C[], m1: C[], pip: number, slPips = 10): Setup | null {
  slPips = Math.max(slPips, atr(m1) / pip); // never tighter than one candle of noise on the lower timeframe
  const b = litBuy(m15, m1, pip, slPips);
  if (b) return b;
  const r = litBuy(mirror(m15), mirror(m1), pip, slPips);
  return r ? { ...r, dir: "SELL", entry: -r.entry, sl: -r.sl, tp: -r.tp, reasons: r.reasons.map(flip) } : null;
}

const toPending = (s: Setup | null, px: number, pip: number): Pending | null =>
  s ? { ...s, kind: "LIMIT", dist: Number((Math.abs(s.entry - px) / pip).toFixed(1)) } : null;

// CRT forming: H4 candle swept one side and closed back inside, but the lower-timeframe CISD has not printed yet.
// Limit order waits at the CRT level (or halfway into the sweep) for the retest.
export function crtPending(h4: C[], m15: C[], pip: number): Setup | null {
  if (h4.length < 4 || !m15.length) return null;
  const px = m15[m15.length - 1].c, gap = 2 * pip;
  for (const b of [h4.length - 2, h4.length - 3]) {
    const base = h4[b], range = base.h - base.l;
    if (range <= 0 || Math.abs(base.c - base.o) / range < 0.55) continue;
    const after = h4.slice(b + 1);
    const hi = max(after.map((k) => k.h)), lo = min(after.map((k) => k.l));
    const last = after[after.length - 1];
    if (hi > base.h && lo >= base.l && last.c < base.h && px < hi) {
      const entry = base.h > px + gap ? base.h : hi > px + gap ? (px + hi) / 2 : 0;
      const s = entry ? mk("CRT", "SELL", entry, hi + pip, base.l, [
        "H4 CRT candle swept CRT High and closed back inside", "Limit sell waits for a retest of the sweep zone", "Target: CRT Low"]) : null;
      if (s) return s;
    }
    if (lo < base.l && hi <= base.h && last.c > base.l && px > lo) {
      const entry = base.l < px - gap ? base.l : lo < px - gap ? (px + lo) / 2 : 0;
      const s = entry ? mk("CRT", "BUY", entry, lo - pip, base.h, [
        "H4 CRT candle swept CRT Low and closed back inside", "Limit buy waits for a retest of the sweep zone", "Target: CRT High"]) : null;
      if (s) return s;
    }
  }
  return null;
}

// CISD retest: a CISD already printed in the direction of the bias after a sweep, price ran away, limit order waits at the CISD level.
export function cisdRetest(m15: C[], h4: C[], pip: number): Setup | null {
  const x = recentCisd(m15), hb = bias(h4);
  if (!x || x.dir !== hb) return null;
  const pre = m15.slice(Math.max(0, x.from - 20), x.from);
  if (pre.length < 5) return null;
  const swept = x.dir === "BUY" ? x.ext < min(pre.map((k) => k.l)) : x.ext > max(pre.map((k) => k.h));
  if (!swept) return null;
  const px = m15[m15.length - 1].c, win = m15.slice(-40);
  const why = [`M15 ${x.dir === "BUY" ? "bullish" : "bearish"} CISD after a liquidity sweep`, "Aligned with H4 bias", "Limit order waits for a retest of the CISD level"];
  if (x.dir === "BUY") return x.level < px - 2 * pip ? mk("CISD", "BUY", x.level, x.ext - pip, max(win.map((k) => k.h)), why) : null;
  return x.level > px + 2 * pip ? mk("CISD", "SELL", x.level, x.ext + pip, min(win.map((k) => k.l)), why) : null;
}

// MSNR+LIT forming (bullish side): BOS happened, price is pulling back toward the POI but has not tapped it yet.
function litPendBuy(m15: C[], pip: number): Setup | null {
  const s = swings(m15), n = m15.length, px = m15[n - 1].c;
  for (const il of [...s.lo].reverse()) {
    if (il < n - 100) break;
    const ph = [...s.hi].reverse().find((i) => i < il);
    if (ph === undefined) continue;
    const level = m15[ph].h;
    const bos = m15.findIndex((k, i) => i > il && k.c > level);
    if (bos < 0) continue;
    const poiHi = Math.max(m15[il].o, m15[il].c), poiLo = m15[il].l;
    if (min(m15.slice(il + 1).map((k) => k.l)) < poiLo) continue; // POI already broken
    if (min(m15.slice(bos + 1).map((k) => k.l)) <= poiHi) continue; // POI already tapped, the live setup handles it
    if (px < poiHi + 2 * pip || px >= level) continue;
    return mk("MSNR+LIT", "BUY", poiHi, poiLo - pip, level, [
      "M15 BOS up, price pulling back toward the POI", "Limit order sits at the POI edge, stop beyond it", "Target: the BOS level"]);
  }
  return null;
}
export function litPending(m15: C[], pip: number): Setup | null {
  if (!m15.length) return null;
  const b = litPendBuy(m15, pip);
  if (b) return b;
  const r = litPendBuy(mirror(m15), pip);
  return r ? { ...r, dir: "SELL", entry: -r.entry, sl: -r.sl, tp: -r.tp, reasons: r.reasons.map(flip) } : null;
}

// Watches a running trade and proposes an order change when it is failing to reach its target.
// cs = the candles since price reached the entry (first one included). Returns progress numbers always, and a change only when something is wrong.
export function manage(
  o: Setup, cs: C[], m15: C[], h4: C[], pip: number,
): { prog: number; bars: number; pnl: number; change?: OrderChange } {
  const buy = o.dir === "BUY", sgn = buy ? 1 : -1;
  const dist = Math.abs(o.tp - o.entry), risk = Math.abs(o.entry - o.sl);
  const bars = Math.max(0, cs.length - 1);
  const cur = cs[cs.length - 1].c;
  // The candle that touched the entry does not count as progress (price was still arriving at the entry), only the candles after it do.
  // It does count against the trade (adv), which is the safer way to read it.
  const after = cs.slice(1);
  const fav = after.length ? Math.max(0, buy ? max(after.map((k) => k.h)) - o.entry : o.entry - min(after.map((k) => k.l))) : 0;
  const adv = Math.max(0, buy ? o.entry - min(cs.map((k) => k.l)) : max(cs.map((k) => k.h)) - o.entry);
  const now = sgn * (cur - o.entry);               // floating profit in price units
  const prog = dist > 0 ? Math.round(Math.max(0, Math.min(1, fav / dist)) * 100) : 0; // best progress toward the target
  const curProg = dist > 0 ? now / dist : 0;       // where price is right now, as a share of the way to the target
  const base = { prog, bars, pnl: Number((now / pip).toFixed(1)) };
  const be = o.entry + sgn * pip;                  // break-even plus one pip
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (bars < 2 || dist <= 0 || risk <= 0) return base;

  // 1. an opposite CISD printed against the trade
  const x = recentCisd(m15);
  if (x && x.dir !== o.dir)
    return { ...base, change: now > pip
      ? { action: "MOVE_SL_TO_BE", level: "DANGER", sl: be, reason: `An opposite ${x.dir === "BUY" ? "bullish" : "bearish"} CISD printed against this ${o.dir}. The target is at risk, so the stop moves to break-even to protect the trade.` }
      : { action: "CLOSE_EARLY", level: "DANGER", reason: `An opposite ${x.dir === "BUY" ? "bullish" : "bearish"} CISD printed against this ${o.dir} while the trade is not in profit. Closing early is safer than waiting for the full stop.` } };

  // 2. price used most of the stop and has barely moved toward the target
  if (adv >= 0.6 * risk && prog < 15 && bars >= 3)
    return { ...base, change: { action: "CLOSE_EARLY", level: "DANGER", reason: `Price is moving against the trade: ${pct(adv / risk)} of the stop is already used and only ${prog}% of the way to the target was ever reached.` } };

  // 3. the trade gave back most of its move
  if (prog >= 50 && curProg < 0.2)
    return { ...base, change: now > pip
      ? { action: "MOVE_SL_TO_BE", level: "WARNING", sl: be, reason: `The trade reached ${prog}% of the way to the target, then gave most of it back. Moving the stop to break-even locks in safety.` }
      : { action: "CLOSE_EARLY", level: "WARNING", reason: `The trade reached ${prog}% of the way to the target, then fell back to the entry. The move has failed, so closing early is safer.` } };

  // 4. the higher-timeframe bias flipped against the trade
  const hb = bias(h4);
  if (hb && hb !== o.dir && o.strategy !== "CRT")
    return { ...base, change: { action: "REDUCE_TP", level: "WARNING", tp: o.entry + sgn * dist * 0.5, reason: `The higher-timeframe bias is now ${hb}, against this ${o.dir}. A full run to the target is less likely, so the target is cut to halfway.` } };

  // 5. the trade is stalling: many candles and it never got going
  if (bars >= 8 && prog < 25)
    return { ...base, change: now > pip
      ? { action: "REDUCE_TP", level: "CAUTION", tp: o.entry + sgn * Math.max(fav * 1.5, dist * 0.5), reason: `${bars} candles after the entry and price only got ${prog}% of the way to the target. It is stalling, so the target is brought closer.` }
      : { action: "TIGHTEN_SL", level: "CAUTION", sl: o.entry - sgn * risk * 0.7, reason: `${bars} candles after the entry and price only got ${prog}% of the way to the target. It is stalling, so the stop is tightened to cut the risk.` } };

  return base;
}

// Replays the last candles to find limit orders that price has already reached.
// An order forms (pending), waits, and is CONFIRMED when a candle trades through its entry.
// It stays confirmed until a later candle hits its stop or target, then it is deleted. Orders whose structure vanished before price arrived are dropped too.
const TRACK = 32;
export function trackFilled(
  d: { h4: C[]; m15: C[] }, pip: number, pass: (s: Setup, h4: C[]) => boolean,
): { filled: Filled[]; spent: Set<string> } {
  const { h4, m15 } = d, n = m15.length;
  const spent = new Set<string>(); // orders that already hit their target or stop: not allowed to re-form until their structure disappears
  if (n < 80) return { filled: [], spent };
  const t4 = h4.map((k) => Date.parse(k.t));
  const rec = new Map<string, { s: Setup; at: number; fill: number }>(); // fill = candle where price reached the entry, -1 while waiting
  for (let i = Math.max(60, n - TRACK); i < n; i++) {
    const k = m15[i], tk = Date.parse(k.t);
    for (const [key, o] of rec) {
      const buy = o.s.dir === "BUY";
      if (o.fill >= 0) {
        // confirmed order: done as soon as a later candle touches the stop or the target. It is deleted and cannot come back with a new, further target
        if (i > o.fill && (buy ? k.l <= o.s.sl || k.h >= o.s.tp : k.h >= o.s.sl || k.l <= o.s.tp)) { rec.delete(key); spent.add(key); }
      } else if (i > o.at && (buy ? k.l <= o.s.entry : k.h >= o.s.entry)) o.fill = i; // price reached the entry
    }
    const hs = Number.isFinite(tk) ? h4.filter((_, j) => !(t4[j] > tk)) : h4;
    const now = new Set<string>(), seen = new Set<string>();
    for (const p of [crtPending(hs, m15.slice(0, i + 1), pip), cisdRetest(m15.slice(0, i + 1), hs, pip), litPending(m15.slice(0, i + 1), pip)]) {
      if (!p || !pass(p, hs)) continue;
      const key = `${p.strategy}|${p.dir}`;
      seen.add(key);
      if (spent.has(key)) continue; // same structure already finished: do not start a new order with an extended target
      now.add(key);
      const o = rec.get(key);
      if (!o) rec.set(key, { s: p, at: i, fill: -1 });
      else if (o.fill < 0) { o.s = p; o.at = i; } // still waiting: follow the latest levels
    }
    for (const key of [...spent]) if (!seen.has(key)) spent.delete(key); // structure is gone: a brand new setup may form later
    for (const [key, o] of rec) {
      if (o.fill >= 0 || now.has(key)) continue;
      // The forming-order functions stop returning an order once price is within a few pips of its entry.
      // That is not "structure gone": keep waiting so the touch of the entry is not missed, unless the stop was already hit.
      const near = Math.abs(k.c - o.s.entry) <= 3 * pip;
      const dead = o.s.dir === "BUY" ? k.l <= o.s.sl : k.h >= o.s.sl;
      if (!near || dead) rec.delete(key); // structure gone before price arrived
    }
  }
  const filled = [...rec.values()].filter((o) => o.fill >= 0).map((o): Filled => ({
    ...o.s, kind: "CONFIRMED", since: m15[o.fill].t, ...manage(o.s, m15.slice(o.fill), m15, h4, pip),
  }));
  return { filled, spent };
}

export type Opts = {
  now?: Date; labels?: { h: string; m: string; l: string }; sessionOn?: boolean; checkMarket?: boolean;
  strategies?: string[]; minRR?: number;
};
export function analyze(d: { h4: C[]; m15: C[]; m1: C[] }, pip: number, o: Opts = {}) {
  const now = o.now ?? new Date(), L = o.labels ?? { h: "H4", m: "M15", l: "M1" };
  const hb = bias(d.h4), hr = now.getUTCHours(), dow = now.getUTCDay();
  const closed = !!o.checkMarket && (dow === 6 || (dow === 5 && hr >= 21) || (dow === 0 && hr < 22));
  const sessionOn = o.sessionOn ?? true; // London / New York kill zones only matter on intraday timeframes
  const inSession = !sessionOn || (hr >= 7 && hr < 10) || (hr >= 12 && hr < 15);
  const minRR = o.minRR ?? 1.5;
  const allowed = (s: Setup) => (!o.strategies || o.strategies.includes(s.strategy)) && s.rr >= minRR;
  const sub = (r: string) => r.replace(/\bH4\b|\bM15\b|\bM1\b/g, (t) => ({ H4: L.h, M15: L.m, M1: L.l } as Record<string, string>)[t]);
  const relabel = <T extends Setup>(s: T): T => ({ ...s, reasons: s.reasons.map(sub) });
  const setups = [crt(d.h4, d.m15, pip), cisdSetup(d.m15, d.h4, pip), lit(d.m15, d.m1, pip)]
    .filter((s): s is Setup => s !== null && allowed(s))
    .map(relabel);
  const ok = setups.filter((s) => s.strategy === "CRT" || s.dir === hb).sort((a, b) => b.rr - a.rr);
  const px = d.m15.length ? d.m15[d.m15.length - 1].c : 0;
  const tr = trackFilled(d, pip, (s, h) => allowed(s) && (s.strategy === "CRT" || s.dir === bias(h)));
  const filled = tr.filled.map(relabel);
  const pending = [crtPending(d.h4, d.m15, pip), cisdRetest(d.m15, d.h4, pip), litPending(d.m15, pip)]
    .filter((s): s is Setup => s !== null && allowed(s) && (s.strategy === "CRT" || s.dir === hb))
    .filter((s) => !setups.some((m) => m.strategy === s.strategy && m.dir === s.dir)) // already live, no limit needed
    .filter((s) => !filled.some((f) => f.strategy === s.strategy && f.dir === s.dir)) // already reached: shown as CONFIRMED instead
    .filter((s) => !tr.spent.has(`${s.strategy}|${s.dir}`)) // target or stop already hit: deleted, not re-created with a further target
    .map((s) => relabel(toPending(s, px, pip)!))
    .sort((a, b) => b.rr - a.rr);
  let decision: { action: Dir | "WAIT"; why: string; setup?: Setup } = { action: "WAIT", why: "No valid setup right now" };
  if (closed) decision = { action: "WAIT", why: "Market is closed for the weekend" };
  else if (filled.length && !(ok.length && inSession)) decision = { action: filled[0].dir, why: `Limit order reached its entry: CONFIRMED (${filled[0].strategy}), RR ${filled[0].rr}`, setup: filled[0] };
  else if (setups.length && !ok.length) decision = { action: "WAIT", why: "Setups found, but against the higher-timeframe bias" };
  else if (ok.length && !inSession) decision = { action: "WAIT", why: "Setup found, but outside London/New York hours" };
  else if (ok.length) decision = { action: ok[0].dir, why: `${ok.filter((s) => s.dir === ok[0].dir).length} strategy(ies) agree, RR ${ok[0].rr}`, setup: ok[0] };
  else if (pending.length) decision = { action: "WAIT", why: `${pending.length} limit order${pending.length > 1 ? "s" : ""} forming, waiting for price to reach entry` };
  return { bias: hb, inSession, sessionOn, closed, setups, pending, filled, decision };
}

export type ScanOpts = { strategies?: string[]; minRR?: number; sessionFilter?: boolean };
export const scan = (d: { demo: boolean; h4: C[]; m15: C[]; m1: C[] }, ins: Inst, tf: Tf, o: ScanOpts = {}) =>
  analyze(d, ins.pip, {
    labels: { h: tf.htf, m: tf.id, l: tf.ltf }, sessionOn: !ins.crypto && tf.min <= 60 && (o.sessionFilter ?? true), // Bitcoin trades 24/7: no London/New York hours, no weekend close
    checkMarket: !d.demo && !ins.crypto, strategies: o.strategies, minRR: o.minRR,
  });
