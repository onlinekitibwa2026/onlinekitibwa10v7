// Free live price feed, no token, no signup, no MetaApi, no OANDA: reads Yahoo Finance's public chart data directly.
// Prices only. The bot never trades through it.
import type { C } from "./engine";

export type Source = "yahoo";
export const GRANS = ["M1", "M5", "M15", "M30", "H1", "H4", "D", "W", "M"] as const;

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Yahoo symbol candidates per pair, tried in order. The one that works is remembered.
// Gold: Yahoo's spot symbol is not always available, so COMEX gold futures (GC=F) is the backup.
const YSYM: Record<string, string[]> = {
  EUR_USD: ["EURUSD=X"], GBP_USD: ["GBPUSD=X"], USD_JPY: ["JPY=X"], USD_CAD: ["CAD=X"], AUD_USD: ["AUDUSD=X"],
  XAU_USD: ["XAUUSD=X", "GC=F", "XAU=X"], BTC_USD: ["BTC-USD"],
};
const good = new Map<string, string>();

// Yahoo has no 4-hour candle, so H4 is built from 1-hour candles.
const YREQ: Record<string, [string, string]> = {
  M1: ["1m", "5d"], M5: ["5m", "1mo"], M15: ["15m", "1mo"], M30: ["30m", "1mo"], H1: ["60m", "6mo"], D: ["1d", "2y"], W: ["1wk", "10y"], M: ["1mo", "20y"],
};
type YRes = { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[] }[] } }[] } };

async function chart(sym: string, interval: string, range: string): Promise<{ status: number; cs?: C[] }> {
  let status = 0;
  for (const host of HOSTS) {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}&includePrePost=false`, {
          signal: AbortSignal.timeout(15000), headers: { "User-Agent": UA, Accept: "application/json" },
        });
        status = r.status;
        if (r.ok) {
          const res = ((await r.json()) as YRes).chart?.result?.[0], q = res?.indicators?.quote?.[0], ts = res?.timestamp;
          if (!q || !ts) return { status: 404 };
          const out: C[] = [];
          ts.forEach((t, k) => {
            const o = q.open[k], h = q.high[k], l = q.low[k], c = q.close[k];
            if (o != null && h != null && l != null && c != null) out.push({ t: new Date(t * 1000).toISOString(), o, h, l, c });
          });
          return { status: 200, cs: out.slice(0, -1) }; // newest candle is still forming
        }
        if (r.status === 404) break; // wrong symbol: retrying will not help
      } catch { status = 0; }
      await sleep(700);
    }
  }
  return { status };
}

async function candles(id: string, interval: string, range: string): Promise<C[]> {
  const list = YSYM[id];
  if (!list) throw new Error("No price symbol for " + id);
  const first = good.get(id);
  const order = first ? [first, ...list.filter((s) => s !== first)] : list;
  let last = 0;
  for (const sym of order) {
    const { status, cs } = await chart(sym, interval, range);
    if (cs && cs.length) { good.set(id, sym); return cs; }
    last = status;
    if (status === 429) break;
  }
  throw new Error(last === 429 ? "The price feed is rate-limiting (429). Wait a minute." : `The price feed returned status ${last || "none"} for ${id}.`);
}

function aggregate(cs: C[], hours: number): C[] {
  const out: C[] = [], step = hours * 3600e3;
  for (const k of cs) {
    const b = Math.floor(Date.parse(k.t) / step) * step, last = out[out.length - 1];
    if (last && Date.parse(last.t) === b) { last.h = Math.max(last.h, k.h); last.l = Math.min(last.l, k.l); last.c = k.c; }
    else out.push({ ...k, t: new Date(b).toISOString() });
  }
  return out.slice(0, -1); // last bucket may be incomplete
}

// ---- Gold: line the numbers up with spot (the price on OANDA / TradingView XAUUSD) ----
// Yahoo may only offer gold FUTURES, which sit a little above spot. A free keyless spot quote (gold-api.com) tells us the gap,
// and that gap is taken off every gold candle so the bot, its alerts and the chart all show the same price.
let spotCache: { at: number; v: number } | null = null;
async function spotGold(): Promise<number | null> {
  if (spotCache && Date.now() - spotCache.at < 15000) return spotCache.v;
  try {
    const r = await fetch("https://api.gold-api.com/price/XAU", { signal: AbortSignal.timeout(4000), headers: { Accept: "application/json" } });
    if (!r.ok) return spotCache?.v ?? null;
    const v = Number(((await r.json()) as { price?: number }).price);
    if (Number.isFinite(v) && v > 100) { spotCache = { at: Date.now(), v }; return v; }
  } catch {}
  return spotCache && Date.now() - spotCache.at < 120000 ? spotCache.v : null;
}
let basis: number | null = null; // futures minus spot, smoothed so one odd tick cannot shift every level
async function goldBasis(lastFut: number): Promise<number> {
  if (good.get("XAU_USD") === "XAUUSD=X") return 0; // already real spot
  const spot = await spotGold();
  if (spot === null) return basis ?? 0;
  const raw = lastFut - spot;
  if (Math.abs(raw) > 60) return basis ?? 0; // does not look like a normal futures gap: leave the data alone
  basis = basis === null || Math.abs(raw - basis) > 6 ? raw : basis * 0.7 + raw * 0.3;
  return basis;
}
const shift = (cs: C[], b: number): C[] => (b ? cs.map((k) => ({ ...k, o: k.o - b, h: k.h - b, l: k.l - b, c: k.c - b })) : cs);

export async function fetchAll(id: string): Promise<{ source: Source; g: Record<string, C[]> }> {
  const g: Record<string, C[]> = {};
  const keys = Object.keys(YREQ);
  // the first request settles which symbol works for this pair, so later ones do not repeat failed tries
  const [iv0, rg0] = YREQ[keys[0]];
  g[keys[0]] = await candles(id, iv0, rg0);
  for (let i = 1; i < keys.length; i += 3) {
    await Promise.all(keys.slice(i, i + 3).map(async (k) => {
      const [iv, rg] = YREQ[k];
      g[k] = await candles(id, iv, rg).catch((e) => { if (k === "W" || k === "M") return [] as C[]; throw e; });
    }));
  }
  g.H4 = aggregate(g.H1, 4);
  if (id === "XAU_USD") {
    const b = await goldBasis(g.M1[g.M1.length - 1].c);
    for (const k of Object.keys(g)) g[k] = shift(g[k], b);
  }
  return { source: "yahoo", g };
}

export async function fetchPrice(id: string) {
  if (id === "XAU_USD" && good.get("XAU_USD") !== "XAUUSD=X") {
    const spot = await spotGold(); // the real spot quote, same number as the chart
    if (spot !== null) return { source: "yahoo" as Source, p: { bid: spot, ask: spot, mid: spot, time: new Date().toISOString() } };
  }
  const cs = await candles(id, "1m", "1d").catch(() => [] as C[]);
  let c = cs[cs.length - 1]?.c;
  if (c && id === "XAU_USD") c -= await goldBasis(c);
  return { source: "yahoo" as Source, p: c ? { bid: c, ask: c, mid: c, time: new Date().toISOString() } : null };
}
