import { NextResponse } from "next/server";
import { getBundle } from "../../../lib/data";
import { instOf } from "../../../lib/config";
import { fetchPrice } from "../../../lib/feed";

export const dynamic = "force-dynamic";

// Live price straight from Yahoo Finance (no token). Falls back to a gently moving demo price if it does not answer.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("instrument") ?? "EUR_USD";
  const ins = instOf(id);
  if (!ins) return NextResponse.json({ error: "Unsupported pair" }, { status: 400 });
  try {
    const { source, p } = await fetchPrice(id);
    if (p) return NextResponse.json({ demo: false, source, ...p });
  } catch {}
  const b = await getBundle(id);
  const last = b.g.M1[b.g.M1.length - 1].c, t = Date.now() / 1000;
  const mid = last + ins.pip * (6 * Math.sin(t / 7) + 3 * Math.sin(t / 2.3));
  const half = ins.pip * 0.4;
  return NextResponse.json({ demo: true, bid: mid - half, ask: mid + half, mid, time: new Date().toISOString() });
}
