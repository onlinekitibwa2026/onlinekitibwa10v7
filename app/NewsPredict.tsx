"use client";

import { useEffect, useState } from "react";
import { TIMEFRAMES } from "../lib/config";
import type { BotSettings } from "../lib/settings";
import type { Prediction } from "../lib/predict";
import type { NewsEvent } from "../lib/news";

type P = Prediction & { status: string };
type Data = {
  demo: boolean; error?: string; at: string;
  news: { ok: boolean; error?: string; stale?: boolean; source?: string; filterOn: boolean; blocked: boolean; reason: string; minsToNext: number | null; upcoming: NewsEvent[] };
  predictions: Record<string, P | null>;
};

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
const left = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
const impactColor = (i: string) => (i === "High" ? "var(--red)" : i === "Medium" ? "var(--gold)" : "var(--muted)");

export default function NewsPredict({ pair, tfId, setTf, show, st, setNewsFilter }: { pair: string; tfId: string; setTf: (id: string) => void; show: number; st: BotSettings; setNewsFilter: (on: boolean) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [fail, setFail] = useState(false);
  const q = `instrument=${pair}&st=${st.strategies.join(",")}&rr=${st.minRR}&sess=${st.sessionFilter ? 1 : 0}&nf=${st.newsFilter ? 1 : 0}&nb=${st.newsBefore}&na=${st.newsAfter}&ni=${st.newsImpact}`;

  useEffect(() => {
    let live = true;
    setD(null);
    const go = () =>
      fetch(`/api/predict?${q}`, { cache: "no-store" })
        .then((x) => (x.ok ? x.json() : Promise.reject()))
        .then((j: Data) => { if (live) { setD(j); setFail(false); } })
        .catch(() => { if (live) setFail(true); });
    go();
    const id = setInterval(go, 20000);
    return () => { live = false; clearInterval(id); };
  }, [q]);

  const p = d?.predictions[tfId] ?? null;
  const n = d?.news;

  return (
    <div className="predgrid">
      {/* NEWS */}
      <div className="card panel">
        <div className="row">
          <div className="label">News calendar</div>
          {n && <span className="tag" style={n.blocked && n.filterOn ? { color: "var(--red)", borderColor: "var(--red)" } : undefined}>{!n.filterOn ? "FILTER OFF" : n.blocked ? "BLOCKED" : "CLEAR"}</span>}
        </div>
        <div className="switchrow" style={{ marginTop: 10 }}>
          <button role="switch" aria-checked={st.newsFilter} aria-label="News filter" className={`switch ${st.newsFilter ? "on" : ""}`} onClick={() => setNewsFilter(!st.newsFilter)}><span /></button>
          <div>
            <div className="label">News filter</div>
            <div className={`big sm ${st.newsFilter ? "up" : ""}`}>{st.newsFilter ? "ON" : "OFF"}</div>
          </div>
        </div>
        <div className="small">{st.newsFilter ? "ON: the bot stops sending alerts for this pair around high-impact news." : "OFF: the bot ignores news and keeps sending alerts."}</div>
        {fail && <div className="error">Could not reach the news and prediction service. Retrying.</div>}
        {!d && !fail && <div className="small">Loading...</div>}
        {n && !n.ok && <div className="warn">The news calendar did not answer ({n.error}). The news filter is not blocking anything until it does.</div>}
        {n?.ok && (
          <>
            {n.blocked && <div className="warn">{n.filterOn ? "News filter active: no new alerts for this pair. " : "High-impact news right now: "}{n.reason}</div>}
            {!n.blocked && n.minsToNext !== null && <div className="small">Next {st.newsImpact === "medium" ? "medium/high" : "high"}-impact news in {left(n.minsToNext)}.</div>}
            {n.stale && <div className="small">Showing the last saved calendar (the feed is busy).</div>}
            {n.upcoming.length === 0 && <div className="small">No {st.newsImpact === "medium" ? "medium or high" : "high"}-impact news for this pair in the loaded calendar.</div>}
            <ul className="log">
              {n.upcoming.map((e, i) => (
                <li key={i}>
                  <span style={{ color: impactColor(e.impact) }}><b>{e.country}</b> {e.title}</span>
                  <span className="small"> | {when(e.time)} | {e.impact}{e.forecast ? ` | forecast ${e.forecast}` : ""}{e.previous ? ` | previous ${e.previous}` : ""}</span>
                </li>
              ))}
            </ul>
            <div className="small">Source: {n.source}. Times are in your local time. The filter uses {st.newsBefore} min before and {st.newsAfter} min after each event.</div>
          </>
        )}
      </div>

      {/* PREDICTION */}
      <div className="card panel">
        <div className="label">Prediction | {tfId}</div>
        {d?.demo && <div className="warn">Simulated data: this prediction is not real. It needs the live price feed.</div>}
        {!p && d && <div className="small">Not enough price history for a prediction on {tfId}.</div>}
        {p && (
          <>
            <div className="grid">
              <div><div className="label">Direction</div><div className={`big ${p.dir === "BUY" ? "up" : "down"}`}>{p.dir}</div></div>
              <div><div className="label">Confidence</div><div className="big">{p.confidence}%</div><div className="small">score {p.score}</div></div>
            </div>
            <div className={`warn ${p.status.startsWith("TRIGGERED") || p.status.startsWith("CONFIRMED") ? "up" : ""}`}>{p.status}</div>
            <div className="label" style={{ marginTop: 16 }}>Possible entries</div>
            {p.entries.map((e, i) => (
              <div key={i} className={`card setup ${e.kind === "MARKET" || e.kind === "CONFIRMED" ? "" : "pend"}`}>
                <div className="row">
                  <div className={`big ${e.dir === "BUY" ? "up" : "down"}`} style={{ fontSize: 17 }}>{e.label}</div>
                  <span className="tag" style={e.state ? { color: "var(--green)", borderColor: "var(--green)" } : undefined}>{e.state ? (e.state === "TRIGGERED" ? "ORDER TRIGGERED" : "RUNNING") : e.kind}</span>
                </div>
                {e.state && e.pnl !== undefined && (
                  <div className={`small ${e.pnl >= 0 ? "up" : "down"}`}>
                    {e.state === "TRIGGERED" ? "Order triggered" : "Running"} since {when(e.since!)} | {e.pnl >= 0 ? "+" : ""}{e.pnl} pips floating | {e.toTp} pips to TP | {e.toSl} pips to SL
                  </div>
                )}
                <div className="small">Entry {e.entry.toFixed(show)} | SL {e.sl.toFixed(show)} | TP {e.tp.toFixed(show)} | RR {e.rr}</div>
                <div className="small">{e.pips > 0 ? `${e.pips} pips from price. ` : ""}{e.note}</div>
              </div>
            ))}
            <div className="label" style={{ marginTop: 16 }}>Why</div>
            <ul className="small">{p.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          </>
        )}
        {d && (
          <div className="tfgrid">
            {TIMEFRAMES.map((t) => {
              const x = d.predictions[t.id];
              return (
                <button key={t.id} onClick={() => setTf(t.id)} className={`tile ${t.id === tfId ? "on" : ""}`} aria-pressed={t.id === tfId}>
                  <span className="tfname">{t.id}</span>
                  <span className={`tact ${x ? (x.dir === "BUY" ? "up" : "down") : ""}`}>{x ? x.dir : "..."}</span>
                  <span className="small">{x ? `${x.confidence}%` : ""}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="small">A prediction is a lean, not a guarantee. It always picks BUY or SELL; the status line says whether the entry is actually confirmed.</div>
      </div>
    </div>
  );
}
