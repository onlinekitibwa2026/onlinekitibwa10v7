// Economic calendar for the news filter and the prediction panel.
// Reads the free weekly Forex Factory feed (no key, no signup). Cached for 15 minutes because the feed rate-limits.
import type { BotSettings } from "./settings";

export type Impact = "High" | "Medium" | "Low" | "Holiday";
export type NewsEvent = { title: string; country: string; time: string; impact: Impact; forecast: string; previous: string };
export type NewsFeed = { events: NewsEvent[]; source: string; at: string; stale?: boolean };

const HOSTS = ["nfs.faireconomy.media", "cdn-nfs.faireconomy.media"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL = 15 * 60e3;
let cache: { at: number; v: NewsFeed } | null = null;
let inflight: Promise<NewsFeed> | null = null;

// Which currencies move each instrument
export const CCY: Record<string, string[]> = {
  EUR_USD: ["EUR", "USD"], GBP_USD: ["GBP", "USD"], USD_JPY: ["USD", "JPY"],
  USD_CAD: ["USD", "CAD"], AUD_USD: ["AUD", "USD"], XAU_USD: ["USD"], BTC_USD: ["USD"],
};

type Raw = { title?: string; country?: string; date?: string; impact?: string; forecast?: string; previous?: string };

async function pull(file: string): Promise<NewsEvent[] | null> {
  for (const h of HOSTS) {
    try {
      const r = await fetch(`https://${h}/${file}`, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json", "User-Agent": UA } });
      if (!r.ok) continue;
      const j = (await r.json()) as Raw[];
      if (!Array.isArray(j)) continue;
      const out: NewsEvent[] = [];
      for (const x of j) {
        const t = Date.parse(x.date ?? "");
        if (!Number.isFinite(t) || !x.title || !x.country) continue;
        const impact: Impact = x.impact === "High" || x.impact === "Medium" || x.impact === "Holiday" ? x.impact : "Low";
        out.push({ title: x.title, country: x.country.toUpperCase(), time: new Date(t).toISOString(), impact, forecast: x.forecast ?? "", previous: x.previous ?? "" });
      }
      return out;
    } catch { /* try the next host */ }
  }
  return null;
}

async function load(): Promise<NewsFeed> {
  const week = await pull("ff_calendar_thisweek.json");
  if (!week) {
    if (cache) return { ...cache.v, stale: true };
    throw new Error("The news calendar did not answer.");
  }
  const next = (await pull("ff_calendar_nextweek.json")) ?? []; // optional: only published late in the week
  const seen = new Set<string>();
  const events = [...week, ...next]
    .filter((e) => { const k = `${e.time}|${e.country}|${e.title}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const v: NewsFeed = { events, source: "Forex Factory calendar", at: new Date().toISOString() };
  cache = { at: Date.now(), v };
  return v;
}

export async function getNews(): Promise<NewsFeed> {
  if (cache && Date.now() - cache.at < TTL) return cache.v;
  inflight ??= load().finally(() => { inflight = null; });
  return inflight;
}

export type NewsRule = Pick<BotSettings, "newsBefore" | "newsAfter" | "newsImpact">;

// Events that can move this instrument, at the impact level the user chose
export const relevant = (events: NewsEvent[], id: string, impact: "high" | "medium") =>
  events.filter((e) => (CCY[id] ?? []).includes(e.country) && (e.impact === "High" || (impact === "medium" && e.impact === "Medium")));

const hm = (iso: string) => new Date(iso).toISOString().slice(11, 16) + " UTC";

// blocked = true while "now" sits inside the window around a relevant event
export function newsState(events: NewsEvent[], id: string, now: Date, rule: NewsRule) {
  const list = relevant(events, id, rule.newsImpact), t = now.getTime();
  const hit = list.find((e) => { const x = Date.parse(e.time); return t >= x - rule.newsBefore * 60e3 && t <= x + rule.newsAfter * 60e3; });
  const next = list.find((e) => Date.parse(e.time) > t) ?? null;
  let reason = "";
  if (hit) {
    const m = Math.round(Math.abs(Date.parse(hit.time) - t) / 60e3);
    reason = `${hit.country} ${hit.title} (${hit.impact}) at ${hm(hit.time)}, ${Date.parse(hit.time) >= t ? `in ${m} min` : `${m} min ago`}`;
  }
  return { blocked: !!hit, reason, next, minsToNext: next ? Math.round((Date.parse(next.time) - t) / 60e3) : null };
}
