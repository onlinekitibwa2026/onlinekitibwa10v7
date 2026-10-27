import type { C } from "./engine";
import { instOf, type Tf } from "./config";
import { fetchAll, GRANS as FEED_GRANS, type Source } from "./feed";

export type Bundle = { demo: boolean; error?: string; source?: Source; g: Record<string, C[]> };

const MIN: Record<string, number> = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D: 1440, W: 10080, M: 43200 };
const GRANS = [...FEED_GRANS] as string[];

function demo(count: number, minutes: number, base: number, key: string): C[] {
  let p = base, seed = 11 + minutes + [...key].reduce((a, ch) => a + ch.charCodeAt(0) * 31, 0);
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const v = base * 0.0004 * Math.sqrt(minutes), now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const o = p, c = o + (r() - 0.5) * v * 2;
    p = c;
    return { t: new Date(now - (count - i) * minutes * 60000).toISOString(), o, h: Math.max(o, c) + r() * v, l: Math.min(o, c) - r() * v, c };
  });
}

// One fetch per granularity gives every timeframe its data (setup, higher and lower frame) at once.
const cache = new Map<string, { at: number; v: Bundle }>();

export async function getBundle(instrument: string): Promise<Bundle> {
  const hit = cache.get(instrument);
  if (hit && Date.now() - hit.at < 20000) return hit.v;
  const ins = instOf(instrument)!;
  const fake = (error?: string): Bundle => ({
    demo: true, error,
    g: Object.fromEntries(GRANS.map((g) => [g, demo(g === "M" ? 120 : 400, MIN[g], ins.base, instrument)])),
  });
  let v: Bundle;
  try {
    const f = await fetchAll(instrument);
    // a feed that answers but returns too little history is treated as "no feed", never as real data
    const thin = GRANS.filter((g) => g !== "W" && g !== "M").some((g) => (f.g[g]?.length ?? 0) < 30);
    v = thin ? fake("The price feed returned too little history. Showing demo data.") : { demo: false, source: f.source, g: { ...Object.fromEntries(GRANS.map((g) => [g, [] as C[]])), ...f.g } };
  } catch (e) {
    v = fake(`${(e as Error).message} Showing demo data.`);
  }
  cache.set(instrument, { at: Date.now(), v });
  return v;
}

// h4 = higher TF, m15 = setup TF, m1 = lower TF (names kept from the engine)
export const frameFor = (b: Bundle, tf: Tf) => ({
  demo: b.demo,
  h4: b.g[tf.htf].slice(-120),
  m15: b.g[tf.id].slice(-300),
  m1: b.g[tf.ltf].slice(-400),
});
