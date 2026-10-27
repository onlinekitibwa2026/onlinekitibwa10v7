import { NextResponse } from "next/server";
import { buildContext, SYSTEM } from "../../../lib/assistant";

export const dynamic = "force-dynamic";

// AI assistant: the dashboard sends the chat so far, the server adds the live market picture and asks Groq (fast, has a free tier).
// Needs GROQ_API_KEY (and the same BOT_SECRET password as the alerts). It never places orders.
export async function POST(req: Request) {
  const env = process.env;
  if (!env.BOT_SECRET || req.headers.get("x-bot-secret") !== env.BOT_SECRET)
    return NextResponse.json({ error: "Wrong bot password. Enter it in Bot settings." }, { status: 401 });
  if (!env.GROQ_API_KEY)
    return NextResponse.json({ error: "The assistant is not switched on yet: add GROQ_API_KEY as a secret in Cloudflare (Workers, Settings, Variables and Secrets) and redeploy." }, { status: 503 });

  let body: { messages?: unknown; pair?: unknown; tf?: unknown } = {};
  try { body = await req.json(); } catch {}
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m): m is { role: string; content: string } => !!m && typeof m === "object" && typeof (m as { content?: unknown }).content === "string" && ["user", "assistant"].includes((m as { role?: string }).role ?? ""))
    .slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });

  const ctx = await buildContext(typeof body.pair === "string" ? body.pair : "XAU_USD", typeof body.tf === "string" ? body.tf : "M15");
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(45000),
      headers: { "content-type": "application/json", authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: env.ASSISTANT_MODEL || "llama-3.3-70b-versatile", max_tokens: 450, temperature: 0.4,
        messages: [{ role: "system", content: SYSTEM(ctx) }, ...msgs],
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    if (!r.ok) return NextResponse.json({ error: j.error?.message ?? `The AI service answered with status ${r.status}.` }, { status: 502 });
    const text = (j.choices?.[0]?.message?.content ?? "").trim();
    return NextResponse.json({ text: text || "I have no answer right now." });
  } catch { return NextResponse.json({ error: "Could not reach the AI service. Try again." }, { status: 502 }); }
}
