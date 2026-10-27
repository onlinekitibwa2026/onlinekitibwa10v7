"use client";

import { useEffect, useRef } from "react";

// Official TradingView Advanced Chart embed.
// It is rebuilt when the symbol or interval changes, and also when the box around it changes size
// (phone turned sideways, window resized, side panel appearing), so it always fills the whole black card.
export default function TradingViewChart({ symbol, interval, bg = "#0a0a0a", grid = "rgba(212,175,55,0.08)" }: { symbol: string; interval: string; bg?: string; grid?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let w0 = 0, h0 = 0, alive = true;

    const mount = () => {
      if (!alive) return;
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return; // wait until the box has a real size
      w0 = w; h0 = h;
      el.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
      const s = document.createElement("script");
      s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      s.async = true;
      s.innerHTML = JSON.stringify({
        autosize: true, symbol, interval, timezone: "Etc/UTC", theme: "dark", style: "1", locale: "en",
        backgroundColor: bg, gridColor: grid, allow_symbol_change: false,
        hide_side_toolbar: w < 700, withdateranges: true, save_image: false,
      });
      el.appendChild(s);
    };

    // first build after the page layout has settled
    const first = requestAnimationFrame(mount);

    // rebuild when the box really changes size (ignores tiny changes such as a phone address bar)
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (Math.abs(w - w0) < 12 && Math.abs(h - h0) < 80) return;
      clearTimeout(timer);
      timer = setTimeout(mount, 300);
    });
    ro.observe(el);

    return () => { alive = false; cancelAnimationFrame(first); clearTimeout(timer); ro.disconnect(); el.innerHTML = ""; };
  }, [symbol, interval, bg, grid]);
  return <div ref={ref} className="tradingview-widget-container tv" />;
}
