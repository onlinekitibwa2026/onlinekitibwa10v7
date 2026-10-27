export type Inst = { id: string; label: string; tv: string; pip: number; dp: number; show: number; base: number; crypto?: boolean };
export type Tf = { id: string; tv: string; min: number; htf: string; ltf: string };

// pip: bot pip size. dp: decimals used on orders. show: decimals on screen. base: demo-data price level.
export const INSTRUMENTS: Inst[] = [
  { id: "EUR_USD", label: "EUR/USD", tv: "FX:EURUSD", pip: 0.0001, dp: 5, show: 5, base: 1.085 },
  { id: "GBP_USD", label: "GBP/USD", tv: "FX:GBPUSD", pip: 0.0001, dp: 5, show: 5, base: 1.27 },
  { id: "USD_JPY", label: "USD/JPY", tv: "FX:USDJPY", pip: 0.01, dp: 3, show: 3, base: 150 },
  { id: "USD_CAD", label: "USD/CAD", tv: "FX:USDCAD", pip: 0.0001, dp: 5, show: 5, base: 1.36 },
  { id: "AUD_USD", label: "AUD/USD", tv: "FX:AUDUSD", pip: 0.0001, dp: 5, show: 5, base: 0.66 },
  { id: "XAU_USD", label: "XAU/USD (Gold)", tv: "OANDA:XAUUSD", pip: 0.1, dp: 3, show: 2, base: 4118 },
  // Bitcoin trades 24/7 (no weekend close). 1 pip = 1 dollar.
  { id: "BTC_USD", label: "BTC/USD (Bitcoin)", tv: "BITSTAMP:BTCUSD", pip: 1, dp: 2, show: 2, base: 100000, crypto: true },
];

// Selected timeframe = setup frame. htf gives the bias, ltf gives the CISD/MSS confirmation.
export const TIMEFRAMES: Tf[] = [
  { id: "M1", tv: "1", min: 1, htf: "M15", ltf: "M1" },
  { id: "M5", tv: "5", min: 5, htf: "H1", ltf: "M1" },
  { id: "M15", tv: "15", min: 15, htf: "H4", ltf: "M1" },
  { id: "M30", tv: "30", min: 30, htf: "H4", ltf: "M5" },
  { id: "H1", tv: "60", min: 60, htf: "D", ltf: "M5" },
  { id: "H4", tv: "240", min: 240, htf: "D", ltf: "M15" },
  { id: "D", tv: "D", min: 1440, htf: "W", ltf: "H4" },
  { id: "W", tv: "W", min: 10080, htf: "M", ltf: "D" },
];
export const instOf = (id: string) => INSTRUMENTS.find((i) => i.id === id);
export const tfOf = (id: string) => TIMEFRAMES.find((t) => t.id === id) ?? TIMEFRAMES[2];
