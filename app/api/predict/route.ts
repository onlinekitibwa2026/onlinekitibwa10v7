import { NextResponse } from "next/server";
import { getBundle, frameFor } from "../../../lib/data";
import { scan } from "../../../lib/engine";
import { instOf, TIMEFRAMES } from "../../../lib/config";
import { STRATEGIES } from "../../../lib/settings";
import { predict } from "../../../lib/predict";
import { getNews, newsState, relevant } from "../../../lib/news";

export const dynamic = "force-dynamic";

const clampN = (v: string | null, d: number, lo: number, hi: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// Prediction (BUY or SELL + possible entries) for every timeframe of one pair, plus the news calendar and the news-filter state.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const instrument = q.get("instrument") ?? "EUR_USD";
  const ins = instOf(instrument);
  if (!ins) return NextResponse.json({ error: "Unsupported pair" }, { status: 400 });
  const st = q.get("st"), rr = Number(q.get("rr"));
  const opts = {
    strategies: st === null ? undefined : STRATEGIES.filter((s) => st.split(",").includes(s)),
    minRR: Number.isFinite(rr) && rr >= 1 && rr <= 10 ? rr : undefined,
    sessionFilter: q.get("sess") !== "0",
  };
  const rule = { newsBefore: clampN(q.get("nb"), 30, 0, 240), newsAfter: clampN(q.get("na"), 30, 0, 240), newsImpact: q.get("ni") === "medium" ? "medium" as const : "high" as const };
  const filterOn = q.get("nf") !== "0";

  const [b, feed] = await Promise.all([getBundle(instrument), getNews().catch((e: Error) => e)]);
  const now = new Date();
  const ok = !(feed instanceof Error);
  const state = ok ? newsState(feed.events, instrument, now, rule) : null;
  const news = ok && state
    ? {
        ok: true, source: feed.source, stale: feed.stale === true, filterOn, blocked: state.blocked, reason: state.reason, minsToNext: state.minsToNext,
        upcoming: relevant(feed.events, instrument, rule.newsImpact).filter((e) => Date.parse(e.time) > now.getTime() - 3600e3).slice(0, 8),
      }
    : { ok: false, error: (feed as Error).message, filterOn, blocked: false, reason: "", minsToNext: null, upcoming: [] };

  const predictions = Object.fromEntries(TIMEFRAMES.map((tf) => {
    const f = frameFor(b, tf), r = scan(f, ins, tf, opts);
    const p = predict(f, ins, r, { h: tf.htf, m: tf.id });
    if (!p) return [tf.id, null];
    const soon = news.minsToNext !== null && news.minsToNext <= 120;
    const status = r.closed ? "MARKET CLOSED"
      : filterOn && news.blocked ? "NEWS BLOCK: do not enter now"
      : r.filled.some((x) => x.dir === p.dir) ? "CONFIRMED: order triggered, trade is running until target or stop"
      : r.decision.action === p.dir ? "TRIGGERED: setup is live"
      : soon ? `WAIT: high-impact news in ${news.minsToNext} min`
      : "WAIT: no confirmed trigger yet";
    return [tf.id, { ...p, status }];
  }));
  return NextResponse.json({ instrument, demo: b.demo, error: b.error, at: now.toISOString(), news, predictions });
}
