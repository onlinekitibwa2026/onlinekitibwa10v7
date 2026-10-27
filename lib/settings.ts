import { INSTRUMENTS, TIMEFRAMES } from "./config";

export const STRATEGIES = ["CRT", "CISD", "MSNR+LIT"] as const;

export type BotSettings = {
  enabled: boolean;      // the auto-trading switch
  pairs: string[];       // instruments the bot may trade
  timeframes: string[];  // timeframes the bot scans
  strategies: string[];  // CRT, CISD, MSNR+LIT
  minRR: number;         // ignore setups with a smaller reward-to-risk
  units: number;         // units per forex trade (sent with the webhook)
  unitsXau: number;      // ounces per gold trade
  unitsBtc: number;      // bitcoin per BTC/USD trade (fractions allowed)
  sessionFilter: boolean; // London / New York hours only (intraday timeframes)
  useLimit: boolean;     // also place limit orders when structure is forming
  limitHours: number;    // limit orders expire after this many hours
  newsFilter: boolean;   // no alerts around high-impact news for the pair's currencies
  newsBefore: number;    // minutes before the news to stop
  newsAfter: number;     // minutes after the news to stay out
  newsImpact: "high" | "medium"; // high = red folder only, medium = red + orange
  secret: string;        // bot password (same as BOT_SECRET), kept in this browser only
  telegramToken: string; // Telegram bot token from @BotFather, kept in this browser only
  telegramChat: string;  // Telegram chat ID that receives the alerts
  whatsappPhone: string; // WhatsApp number with country code (CallMeBot)
  whatsappKey: string;   // CallMeBot API key
  webhookUrl: string;    // https link the bot POSTs every setup to (for example an OANDA execution bridge)
  webhookSecret: string; // optional secret sent with the webhook
};

export const DEFAULTS: BotSettings = {
  enabled: false,
  pairs: INSTRUMENTS.map((i) => i.id),
  timeframes: TIMEFRAMES.map((t) => t.id),
  strategies: [...STRATEGIES],
  minRR: 1.5,
  units: 1000,
  unitsXau: 1,
  unitsBtc: 0.01,
  sessionFilter: true,
  useLimit: true,
  limitHours: 8,
  newsFilter: true, newsBefore: 30, newsAfter: 30, newsImpact: "high",
  secret: "",
  telegramToken: "", telegramChat: "", whatsappPhone: "", whatsappKey: "", webhookUrl: "", webhookSecret: "",
};

const num = (v: unknown, d: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const pick = (v: unknown, all: readonly string[], d: readonly string[]) =>
  Array.isArray(v) ? all.filter((a) => v.includes(a)) : [...d];

// Used on both the browser and the server so bad values never reach the broker.
export function clean(x: unknown): BotSettings {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    pairs: pick(o.pairs, INSTRUMENTS.map((i) => i.id), DEFAULTS.pairs),
    timeframes: pick(o.timeframes, TIMEFRAMES.map((t) => t.id), DEFAULTS.timeframes),
    strategies: pick(o.strategies, STRATEGIES, DEFAULTS.strategies),
    minRR: num(o.minRR, DEFAULTS.minRR, 1, 10),
    units: Math.round(num(o.units, DEFAULTS.units, 1, 1_000_000)),
    unitsXau: Math.round(num(o.unitsXau, DEFAULTS.unitsXau, 1, 1000)),
    unitsBtc: Number(num(o.unitsBtc, DEFAULTS.unitsBtc, 0.0001, 100).toFixed(4)),
    sessionFilter: o.sessionFilter !== false,
    useLimit: o.useLimit !== false,
    limitHours: num(o.limitHours, DEFAULTS.limitHours, 1, 72),
    newsFilter: o.newsFilter !== false,
    newsBefore: Math.round(num(o.newsBefore, DEFAULTS.newsBefore, 0, 240)),
    newsAfter: Math.round(num(o.newsAfter, DEFAULTS.newsAfter, 0, 240)),
    newsImpact: o.newsImpact === "medium" ? "medium" : "high",
    secret: typeof o.secret === "string" ? o.secret : "",
    telegramToken: str(o.telegramToken, 80),
    telegramChat: str(o.telegramChat, 40),
    whatsappPhone: str(o.whatsappPhone, 24),
    whatsappKey: str(o.whatsappKey, 40),
    webhookUrl: str(o.webhookUrl, 500),
    webhookSecret: str(o.webhookSecret, 100),
  };
}
