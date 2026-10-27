// Soft background melodies, made live in the browser (no audio files). Gentle pentatonic notes over a quiet warm pad.
// The music fades down while the assistant speaks and swells back up when it is quiet.
let ctx: AudioContext | null = null, master: GainNode | null = null, pad: OscillatorNode[] = [];
let timer: ReturnType<typeof setTimeout> | undefined, padTimer: ReturnType<typeof setInterval> | undefined;
let on = false, ducked = false, step = 0;

const LEVEL = 0.55, DUCK = 0.08;
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25]; // C major pentatonic
const ROOTS = [130.81, 110.0, 87.31, 98.0]; // C, A, F, G: a slow, friendly loop

export const ambientOn = () => on;

function note(freq: number) {
  if (!ctx || !master) return;
  const t = ctx.currentTime, g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.085, t + 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
  g.connect(master);
  [[freq, "sine", 1], [freq * 2, "triangle", 0.12]].forEach(([f, type, v]) => {
    const o = ctx!.createOscillator(), og = ctx!.createGain();
    o.type = type as OscillatorType; o.frequency.value = f as number; og.gain.value = v as number;
    o.connect(og); og.connect(g); o.start(t); o.stop(t + 5.2);
  });
}

function next() {
  if (!on) return;
  // wander up and down the scale in small steps, with an occasional rest, so it stays calm and never repeats exactly
  if (Math.random() > 0.2) {
    step = Math.max(0, Math.min(SCALE.length - 1, step + Math.round((Math.random() - 0.5) * 4)));
    note(SCALE[step]);
    if (Math.random() > 0.65) setTimeout(() => on && note(SCALE[Math.max(0, step - 2)]), 700);
  }
  timer = setTimeout(next, 2200 + Math.random() * 2800);
}

export function startAmbient() {
  if (on) return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    void ctx.resume();
    master = ctx.createGain();
    master.gain.value = 0.0001;
    // a soft echo gives the notes space
    const delay = ctx.createDelay(1.5), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
    delay.delayTime.value = 0.5; fb.gain.value = 0.45; lp.type = "lowpass"; lp.frequency.value = 1600;
    master.connect(ctx.destination);
    master.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(ctx.destination);
    // warm pad: root plus a fifth
    pad = [1, 1.5].map((m, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      o.type = "sine"; o.frequency.value = ROOTS[0] * m; g.gain.value = i ? 0.025 : 0.045;
      o.connect(g); g.connect(master!); o.start(); return o;
    });
    let r = 0;
    padTimer = setInterval(() => {
      r = (r + 1) % ROOTS.length;
      pad.forEach((o, i) => o.frequency.setTargetAtTime(ROOTS[r] * (i ? 1.5 : 1), ctx!.currentTime, 2.5));
    }, 16000);
    on = true;
    master.gain.setTargetAtTime(ducked ? DUCK : LEVEL, ctx.currentTime, 1.5);
    timer = setTimeout(next, 1200);
  } catch { on = false; }
}

export function stopAmbient() {
  on = false;
  clearTimeout(timer); clearInterval(padTimer);
  if (!ctx || !master) return;
  const c = ctx;
  master.gain.setTargetAtTime(0.0001, c.currentTime, 0.4);
  pad.forEach((o) => { try { o.stop(c.currentTime + 1.5); } catch {} });
  setTimeout(() => { try { void c.close(); } catch {} }, 1800);
  ctx = null; master = null; pad = [];
}

// Lower the music while the assistant talks, bring it back when it is quiet
export function duck(down: boolean) {
  ducked = down;
  if (ctx && master) master.gain.setTargetAtTime(down ? DUCK : LEVEL, ctx.currentTime, down ? 0.25 : 1.2);
}
