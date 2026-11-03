// Pure trading logic for the TTM engine (paper trading). No network, no database. Tested on its own.
export type Candle = {t: number; o: number; h: number; l: number; c: number};
export type Pos = {id: number; pair: string; side: "long" | "short"; entry: number; units: number; notional: number; lev: number; margin: number; sl: number; tp: number | null; risk_usd: number; opened_at: string};
export type Cfg = {risk_pct: number; max_open: number; max_lev: number; pairs: string[]};
export type Decision = {pair?: string; action?: string; sl?: number; tp?: number | null; lev?: number; reason?: string};
export const FEE = 0.0006;           // taker fee per side
export const HOUR = 3600000;

export function ema(v: number[], n: number): number { const k = 2 / (n + 1); let e = v[0]; for (let i = 1; i < v.length; i++) e = v[i] * k + e * (1 - k); return e; }
export function rsi(cl: number[], n = 14): number | null {
  if (cl.length <= n) return null; let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = cl[i] - cl[i - 1]; if (d >= 0) g += d; else l -= d; } g /= n; l /= n;
  for (let i = n + 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
export function atr(c: Candle[], n = 14): number | null {
  if (c.length <= n) return null; const tr = (i: number) => Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  let a = 0; for (let i = 1; i <= n; i++) a += tr(i); a /= n; for (let i = n + 1; i < c.length; i++) a = (a * (n - 1) + tr(i)) / n; return a;
}
const r = (x: number | null, d = 2) => x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;
export function snapshot(pair: string, c: Candle[]) {
  const cl = c.map((x) => x.c), p = cl[cl.length - 1], at = (n: number) => cl.length > n ? (p / cl[cl.length - 1 - n] - 1) * 100 : null, last24 = c.slice(-24), a = atr(c);
  const sig = (x: number) => x >= 100 ? 2 : x >= 1 ? 4 : 6;
  return {pair, price: r(p, sig(p)), change_1h_pct: r(at(1)), change_4h_pct: r(at(4)), change_24h_pct: r(at(24)), rsi14: r(rsi(cl), 1), ema20: r(ema(cl.slice(-60), 20), sig(p)), ema50: r(ema(cl.slice(-100), 50), sig(p)),
    atr14: r(a, sig(p)), atr_pct: a == null ? null : r(a / p * 100), high_24h: r(Math.max(...last24.map((x) => x.h)), sig(p)), low_24h: r(Math.min(...last24.map((x) => x.l)), sig(p)), last_12_closes: cl.slice(-12).map((x) => r(x, sig(p)))};
}
export function pnlOf(p: Pos, exit: number): number { const gross = (p.side === "long" ? exit - p.entry : p.entry - exit) * p.units; return gross - (p.notional + exit * p.units) * FEE; }
// did the stop or target trade since the position opened? stop wins when both sit in one candle (the careful assumption)
export function checkExit(p: Pos, candles: Candle[], period = HOUR): {price: number; reason: "stop" | "target"} | null {
  const opened = new Date(p.opened_at).getTime();
  for (const c of candles) {
    if (c.t + period <= opened) continue;
    if (p.side === "long") { if (c.l <= p.sl) return {price: Math.min(p.sl, c.o), reason: "stop"}; if (p.tp != null && c.h >= p.tp) return {price: p.tp, reason: "target"}; }
    else { if (c.h >= p.sl) return {price: Math.max(p.sl, c.o), reason: "stop"}; if (p.tp != null && c.l <= p.tp) return {price: p.tp, reason: "target"}; }
  }
  return null;
}
export function validateOpen(d: Decision, price: number, equity: number, cash: number, open: Pos[], cfg: Cfg):
  {ok: true; pos: {side: "long" | "short"; entry: number; units: number; notional: number; lev: number; margin: number; sl: number; tp: number | null; risk_usd: number}} | {ok: false; reason: string} {
  const side = d.action === "open_long" ? "long" : d.action === "open_short" ? "short" : null; if (!side) return {ok: false, reason: "not an open action"};
  if (!d.pair || !cfg.pairs.includes(d.pair)) return {ok: false, reason: "pair not allowed"};
  if (!(price > 0)) return {ok: false, reason: "no price"};
  if (open.some((p) => p.pair === d.pair)) return {ok: false, reason: "already holding this pair"};
  if (open.length >= cfg.max_open) return {ok: false, reason: "max open positions reached"};
  const sl = Number(d.sl); if (!isFinite(sl) || sl <= 0) return {ok: false, reason: "stop loss missing"};
  if (side === "long" ? sl >= price : sl <= price) return {ok: false, reason: "stop loss on the wrong side"};
  const dist = Math.abs(price - sl) / price; if (dist < 0.004) return {ok: false, reason: "stop too tight (under 0.4%)"}; if (dist > 0.12) return {ok: false, reason: "stop too wide (over 12%)"};
  let tp: number | null = null;
  if (d.tp != null && d.tp !== (null as unknown)) { tp = Number(d.tp); if (!isFinite(tp) || tp <= 0) return {ok: false, reason: "bad take profit"}; if (side === "long" ? tp <= price : tp >= price) return {ok: false, reason: "take profit on the wrong side"}; if (Math.abs(tp - price) / Math.abs(price - sl) < 1.2) return {ok: false, reason: "reward to risk under 1.2"}; }
  const lev = Math.min(Math.max(Number(d.lev) || 1, 1), cfg.max_lev);
  let units = (equity * cfg.risk_pct / 100) / Math.abs(price - sl);
  units = Math.min(units, equity * lev / price);                 // never bigger than the leverage allows
  units = Math.min(units, Math.max(0, cash) * lev * 0.98 / price); // nor than the free cash
  const notional = units * price; if (notional < 50) return {ok: false, reason: "position too small or no free cash"};
  return {ok: true, pos: {side, entry: price, units, notional, lev, margin: notional / lev, sl, tp, risk_usd: units * Math.abs(price - sl)}};
}
export function parseDecisions(text: string): Decision[] {
  const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a < 0 || b <= a) return [];
  try { const j = JSON.parse(text.slice(a, b + 1)); return Array.isArray(j.decisions) ? j.decisions.slice(0, 10) : []; } catch (_) { return []; }
}
export const SYSTEM = `You are the decision module of a paper trading engine for USDT-margined crypto perpetual futures on Bitget. No real money is used yet; the goal is to show careful, rules-based trading.
You get a market snapshot for each allowed pair, the open positions and the account. Decide, per pair, one of: open_long, open_short, close, hold.
Rules you must follow (the engine rejects anything that breaks them):
- Every open needs a stop loss ("sl") on the correct side, between 0.4% and 12% from the current price. A take profit ("tp") is optional but must be at least 1.2 times the stop distance away.
- Leverage ("lev") between 1 and the stated maximum. The engine sizes the position from the risk limit, so do not give a size.
- Never open a pair that is already held. Use "close" to exit a held pair early when the idea is no longer valid.
- Most hours the right answer is "hold". Only trade a clear setup with a defined invalidation level. Do not chase moves or add to losers.
Reply with JSON only, no other text: {"decisions":[{"pair":"BTCUSDT","action":"hold","reason":"one or two plain sentences"}]}
For an open include "sl", "tp" (or null) and "lev". Include a short plain reason for every decision.`;
