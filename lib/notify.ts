// Sends the bot's alerts: Telegram, WhatsApp (CallMeBot) and a webhook. Credentials come from Bot settings (browser) and are never stored on the server.
import type { Filled, Setup } from "./engine";
import type { BotSettings } from "./settings";

const T = () => AbortSignal.timeout(10000);
export type Out = { channel: string; ok: boolean; reason?: string };

export const channelsOf = (s: BotSettings) => ({
  telegram: !!(s.telegramToken && s.telegramChat),
  whatsapp: !!(s.whatsappPhone && s.whatsappKey),
  webhook: !!s.webhookUrl,
});

export async function sendTelegram(s: BotSettings, text: string): Promise<Out> {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(s.telegramToken)) return { channel: "Telegram", ok: false, reason: "Telegram bot token looks wrong" };
  if (!/^(-?\d+|@[A-Za-z0-9_]+)$/.test(s.telegramChat)) return { channel: "Telegram", ok: false, reason: "Telegram chat ID looks wrong" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: s.telegramChat, text }), signal: T(),
    });
    if (r.ok) return { channel: "Telegram", ok: true };
    const j = (await r.json().catch(() => ({}))) as { description?: string };
    return { channel: "Telegram", ok: false, reason: j.description ?? `status ${r.status}` };
  } catch { return { channel: "Telegram", ok: false, reason: "could not reach Telegram" }; }
}

// WhatsApp through CallMeBot (free personal service). The phone must be activated with CallMeBot first to get the API key.
export async function sendWhatsApp(s: BotSettings, text: string): Promise<Out> {
  const phone = s.whatsappPhone.replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (!/^\d{7,15}$/.test(phone)) return { channel: "WhatsApp", ok: false, reason: "WhatsApp number looks wrong (use country code, digits only)" };
  if (!/^[A-Za-z0-9]{3,40}$/.test(s.whatsappKey)) return { channel: "WhatsApp", ok: false, reason: "WhatsApp API key looks wrong" };
  try {
    const r = await fetch(`https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(text.slice(0, 900))}&apikey=${s.whatsappKey}`, { signal: T() });
    return r.ok ? { channel: "WhatsApp", ok: true } : { channel: "WhatsApp", ok: false, reason: `status ${r.status}` };
  } catch { return { channel: "WhatsApp", ok: false, reason: "could not reach CallMeBot" }; }
}

// Only public https addresses with a normal name are allowed, so the webhook cannot be pointed at internal servers
export function safeUrl(u: string): URL | null {
  try {
    const x = new URL(u);
    const h = x.hostname.toLowerCase();
    if (x.protocol !== "https:" || x.username || x.password) return null;
    if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || /(^|\.)(local|localhost|internal|lan|home)$/.test(h)) return null;
    return x;
  } catch { return null; }
}

export async function sendWebhook(s: BotSettings, payload: Record<string, unknown>): Promise<Out> {
  const u = safeUrl(s.webhookUrl);
  if (!u) return { channel: "Webhook", ok: false, reason: "Webhook address must be a public https:// link" };
  try {
    const r = await fetch(u.toString(), {
      method: "POST", redirect: "manual", signal: T(),
      headers: { "Content-Type": "application/json", ...(s.webhookSecret ? { "x-webhook-secret": s.webhookSecret } : {}) },
      body: JSON.stringify({ ...payload, ...(s.webhookSecret ? { secret: s.webhookSecret } : {}) }),
    });
    return r.ok ? { channel: "Webhook", ok: true } : { channel: "Webhook", ok: false, reason: `status ${r.status}` };
  } catch { return { channel: "Webhook", ok: false, reason: "could not reach the webhook" }; }
}

export type Item = { label: string; id: string; tf: string; limit: boolean; s: Setup; show: number; units: number; expiresAt?: string };

export const textFor = (i: Item) =>
  [
    `ONLINE KITIBWA | ${i.label} ${i.tf}`,
    `${i.s.dir} ${i.limit ? "LIMIT (structure forming)" : "setup"} | ${i.s.strategy}`,
    `Entry ${i.s.entry.toFixed(i.show)}`,
    `SL ${i.s.sl.toFixed(i.show)}`,
    `TP ${i.s.tp.toFixed(i.show)}`,
    `RR ${i.s.rr}`,
    i.s.reasons.slice(0, 3).join("; "),
  ].join("\n");

export const payloadFor = (i: Item) => ({
  source: "ONLINE KITIBWA", event: i.limit ? "limit_order" : "signal", time: new Date().toISOString(),
  instrument: i.id, label: i.label, timeframe: i.tf, strategy: i.s.strategy, direction: i.s.dir,
  order_type: i.limit ? "LIMIT" : "MARKET", entry: Number(i.s.entry.toFixed(i.show)), stop_loss: Number(i.s.sl.toFixed(i.show)),
  take_profit: Number(i.s.tp.toFixed(i.show)), rr: i.s.rr, units: i.units, ...(i.expiresAt ? { expires_at: i.expiresAt } : {}), reasons: i.s.reasons,
});

// Sends one item to every channel that is filled in
export function sendAll(s: BotSettings, i: Item): Promise<Out[]> {
  const c = channelsOf(s), text = textFor(i), jobs: Promise<Out>[] = [];
  if (c.telegram) jobs.push(sendTelegram(s, text));
  if (c.whatsapp) jobs.push(sendWhatsApp(s, text));
  if (c.webhook) jobs.push(sendWebhook(s, payloadFor(i)));
  return Promise.all(jobs);
}

// Order change: a running trade is failing to reach its target, so the bot proposes a change and gives the warning reason.
export type ChangeItem = { label: string; id: string; tf: string; f: Filled; show: number; units: number };
export const ACTION_TEXT: Record<string, string> = {
  MOVE_SL_TO_BE: "Move stop loss to break-even", TIGHTEN_SL: "Tighten stop loss", REDUCE_TP: "Reduce take profit", CLOSE_EARLY: "Close the trade early",
};

export const changeText = (i: ChangeItem) => {
  const c = i.f.change!;
  return [
    `ONLINE KITIBWA | ORDER CHANGE | ${i.label} ${i.tf}`,
    `WARNING: ${c.reason}`,
    `${i.f.dir} ${i.f.strategy} | Entry ${i.f.entry.toFixed(i.show)} | SL ${i.f.sl.toFixed(i.show)} | TP ${i.f.tp.toFixed(i.show)}`,
    `Action: ${ACTION_TEXT[c.action]}`,
    ...(c.sl !== undefined ? [`New SL ${c.sl.toFixed(i.show)}`] : []),
    ...(c.tp !== undefined ? [`New TP ${c.tp.toFixed(i.show)}`] : []),
  ].join("\n");
};

export const changePayload = (i: ChangeItem) => {
  const c = i.f.change!;
  return {
    source: "ONLINE KITIBWA", event: "order_change", time: new Date().toISOString(),
    instrument: i.id, label: i.label, timeframe: i.tf, strategy: i.f.strategy, direction: i.f.dir,
    entry: Number(i.f.entry.toFixed(i.show)), stop_loss: Number(i.f.sl.toFixed(i.show)), take_profit: Number(i.f.tp.toFixed(i.show)),
    action: c.action, level: c.level, warning: c.reason,
    ...(c.sl !== undefined ? { new_stop_loss: Number(c.sl.toFixed(i.show)) } : {}),
    ...(c.tp !== undefined ? { new_take_profit: Number(c.tp.toFixed(i.show)) } : {}),
    units: i.units,
  };
};

export function sendChange(s: BotSettings, i: ChangeItem): Promise<Out[]> {
  const c = channelsOf(s), text = changeText(i), jobs: Promise<Out>[] = [];
  if (c.telegram) jobs.push(sendTelegram(s, text));
  if (c.whatsapp) jobs.push(sendWhatsApp(s, text));
  if (c.webhook) jobs.push(sendWebhook(s, changePayload(i)));
  return Promise.all(jobs);
}
