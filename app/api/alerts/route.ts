import { NextResponse } from "next/server";
import { getBundle, frameFor } from "../../../lib/data";
import { scan, type Pending, type Setup } from "../../../lib/engine";
import { INSTRUMENTS, TIMEFRAMES, tfOf } from "../../../lib/config";
import { clean, DEFAULTS } from "../../../lib/settings";
import { channelsOf, sendAll, sendChange, type Item } from "../../../lib/notify";
import { getNews, newsState } from "../../../lib/news";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const MAX_PER_RUN = 6;

// The dashboard calls this every 30 seconds while the alert switch is ON (header x-bot-secret, settings in the body).
// It scans the chosen pairs and timeframes and sends Telegram / WhatsApp / webhook messages for NEW setups only.
// It never places orders itself: a webhook receiver (for example an OANDA bridge) does the executing.
export async function POST(req: Request) {
  const env = process.env;
  if (!env.BOT_SECRET || req.headers.get("x-bot-secret") !== env.BOT_SECRET)
    return NextResponse.json({ error: "Wrong bot password" }, { status: 401 });

  let body: { settings?: unknown; sent?: unknown; test?: unknown } = {};
  try { body = await req.json(); } catch {}
  const st = clean(body.settings ?? DEFAULTS);
  const ch = channelsOf(st);
  if (!ch.telegram && !ch.whatsapp && !ch.webhook)
    return NextResponse.json({ error: "Add Telegram, WhatsApp or a webhook in Bot settings first." }, { status: 400 });

  // Test button: one sample message to every channel that is filled in
  if (body.test === true) {
    const ins = INSTRUMENTS.find((i) => i.id === "XAU_USD")!;
    const sample: Setup = { strategy: "TEST", dir: "BUY", entry: 2000, sl: 1990, tp: 2020, rr: 2, reasons: ["This is only a test message from ONLINE KITIBWA"] };
    const out = await sendAll(st, { label: ins.label, id: ins.id, tf: "TEST", limit: false, s: sample, show: ins.show, units: st.unitsXau });
    return NextResponse.json({ test: true, channels: out });
  }

  if (!st.enabled) return NextResponse.json({ skipped: "Alerts are switched off" });

  const sent = new Set<string>(Array.isArray(body.sent) ? (body.sent as unknown[]).filter((x): x is string => typeof x === "string").slice(-600) : []);
  const rows: Row[] = [], keys: string[] = [];
  const tfs = TIMEFRAMES.filter((t) => st.timeframes.includes(t.id));
  let count = 0;
  // News filter: if the calendar cannot be reached the bot carries on as before (it never blocks on a missing calendar)
  const news = st.newsFilter ? await getNews().catch(() => null) : null;

  for (const ins of INSTRUMENTS.filter((i) => st.pairs.includes(i.id))) {
    const b = await getBundle(ins.id);
    if (b.demo) { rows.push({ instrument: ins.label, skipped: b.error ?? "no live price feed, so no alerts are sent (simulated prices are never sent)" }); continue; }

    const nb = news ? newsState(news.events, ins.id, new Date(), st) : null;
    const units = ins.id === "XAU_USD" ? st.unitsXau : ins.id === "BTC_USD" ? st.unitsBtc : st.units;

    const items: Item[] = [];
    let anyChange = false;
    for (const tf of tfs) {
      const r = scan(frameFor(b, tf), ins, tf, { strategies: st.strategies, minRR: st.minRR, sessionFilter: st.sessionFilter });
      // Position management: a running trade that is failing to reach its target gets an order change with a warning reason.
      // This is never blocked by the news filter or the session filter, because an open trade must always be watched.
      for (const f of r.filled) {
        if (!f.change) continue;
        const ckey = `${ins.id}|${tf.id}|CHG|${f.strategy}|${f.dir}|${f.sl.toFixed(ins.show)}|${f.change.action}`;
        if (sent.has(ckey) || count >= MAX_PER_RUN) continue;
        count++; anyChange = true;
        const out = await sendChange(st, { label: ins.label, id: ins.id, tf: tf.id, f, show: ins.show, units });
        const ok = out.some((o) => o.ok);
        if (ok) keys.push(ckey);
        rows.push({
          instrument: ins.label, tf: tf.id, kind: "ORDER CHANGE", dir: f.dir, strategy: f.strategy,
          entry: f.entry.toFixed(ins.show), sl: f.sl.toFixed(ins.show), tp: f.tp.toFixed(ins.show), rr: f.rr, ok,
          sent: out.filter((o) => o.ok).map((o) => o.channel).join(", "),
          reason: out.filter((o) => !o.ok).map((o) => `${o.channel}: ${o.reason}`).join("; ") || undefined,
        });
      }
      if (nb?.blocked) continue; // news filter: no NEW setups for this pair
      const mk = (s: Setup, limit: boolean): Item => ({
        label: ins.label, id: ins.id, tf: tf.id, limit, s, show: ins.show, units,
        ...(limit ? { expiresAt: new Date(Date.now() + st.limitHours * 3600e3).toISOString() } : {}),
      });
      if (r.decision.setup) items.push(mk(r.decision.setup, false));
      if (st.useLimit && !r.closed && r.inSession) r.pending.forEach((p: Pending) => items.push(mk(p as Setup, true)));
    }
    let any = false;
    for (const it of items.sort((a, c) => c.s.rr - a.s.rr)) {
      // same pair, timeframe, kind, strategy, direction and stop level = same setup, so it is only sent once
      const key = `${it.id}|${it.tf}|${it.limit ? "L" : "M"}|${it.s.strategy}|${it.s.dir}|${it.s.sl.toFixed(it.show)}`;
      if (sent.has(key)) continue;
      if (count >= MAX_PER_RUN) break;
      count++; any = true;
      const out = await sendAll(st, it);
      const ok = out.some((o) => o.ok);
      if (ok) keys.push(key);
      rows.push({
        instrument: ins.label, tf: it.tf, kind: it.limit ? "LIMIT" : "MARKET", dir: it.s.dir, strategy: it.s.strategy,
        entry: it.s.entry.toFixed(it.show), sl: it.s.sl.toFixed(it.show), tp: it.s.tp.toFixed(it.show), rr: it.s.rr, ok,
        sent: out.filter((o) => o.ok).map((o) => o.channel).join(", "),
        reason: out.filter((o) => !o.ok).map((o) => `${o.channel}: ${o.reason}`).join("; ") || undefined,
      });
    }
    if (!any && !anyChange) rows.push({ instrument: ins.label, skipped: nb?.blocked ? `news filter: ${nb.reason}` : "no new setup" });
  }
  return NextResponse.json({ at: new Date().toISOString(), results: rows, keys });
}
