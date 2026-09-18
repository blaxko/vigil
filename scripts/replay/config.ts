/**
 * Single source of truth for the historical replay window and its two
 * "anchor" price parameters. Every other replay script imports these
 * constants rather than hardcoding a price or timestamp inline, so the
 * whole harness can be re-pointed at a different data source (or a
 * different weekend) by editing exactly this file.
 *
 * === Pyth Benchmarks blocker (read before changing FRIDAY_CLOSE_ANCHOR) ===
 * The brief calls for the "frozen" anchor to come from Pyth's Benchmarks
 * API. As of this build, both `benchmarks.pyth.network/v1/updates/price/{ts}`
 * and `hermes.pyth.network/v2/updates/price/{ts}` return 401 Unauthorized
 * for every timestamp tested (including one from an hour before the
 * request), and the older public TradingView-shim history endpoint the
 * brief's .env.example references (`/v1/shims/tradingview/history`) 404s --
 * it appears to have been retired. Neither is reachable without an API key,
 * which wasn't available when this was built.
 *
 * SOURCE is currently "gecko-derived": FRIDAY_CLOSE_ANCHOR_PRICE_USD and
 * MONDAY_REOPEN_PRICE_USD are both read directly from
 * `historical-data.json` (real GeckoTerminal AAPLx/USDC OHLCV, fetched by
 * `fetch-historical-data.ts`) at the candle nearest the real NYSE
 * close/open moments -- not invented, but not Pyth's own feed either. This
 * is a faithful stand-in (AAPLx is arbitraged against real AAPL during
 * market hours, so its DEX price tracks Pyth's equity print closely at the
 * close/open boundary) rather than a literal Pyth read.
 *
 * TO SWITCH TO REAL PYTH DATA once an API key is available:
 *   1. Set SOURCE below to "pyth-benchmarks".
 *   2. Fetch the real historical print for FRIDAY_CLOSE_UTC /
 *      MONDAY_OPEN_UTC from Pyth Benchmarks using PYTH_AAPL_FEED_ID below,
 *      and set PYTH_FRIDAY_CLOSE_PRICE_USD / PYTH_MONDAY_OPEN_PRICE_USD.
 *   3. Nothing else in the harness changes -- `getFridayCloseAnchorUsd()`
 *      and `getMondayReopenAnchorUsd()` are the only functions every other
 *      replay script calls, and they switch source automatically.
 */

export type AnchorSource = "gecko-derived" | "pyth-benchmarks";

export const SOURCE: AnchorSource = "gecko-derived";

// Real Pyth equity feed id for Equity.US.AAPL/USD (confirmed live via
// Hermes' /v2/price_feeds search, which is NOT auth-gated -- only the
// historical price-at-timestamp endpoints are).
export const PYTH_AAPL_FEED_ID = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

// Fill these in once a Pyth Benchmarks API key is available (step 2 above).
export const PYTH_FRIDAY_CLOSE_PRICE_USD: number | null = null;
export const PYTH_MONDAY_OPEN_PRICE_USD: number | null = null;

// The real, completed weekend this replay uses -- the most recent full
// Friday-close-to-Monday-open window as of when this was built.
export const FRIDAY_CLOSE_UTC = "2026-09-11T20:00:00Z"; // NYSE 4:00pm ET close
export const MONDAY_OPEN_UTC = "2026-09-14T13:30:00Z"; // NYSE 9:30am ET open

// The real, currently-trading AAPLx/USDC pool on Solana (found via
// GeckoTerminal pool search; verify it's still the active pool before
// reusing this config for a different weekend).
export const GECKOTERMINAL_NETWORK = "solana";
export const GECKOTERMINAL_POOL_ADDRESS = "EHdow7Yhmr1ac8Qff9Co1LhSosr38puA6zLd4cbJLdpV";

// GeckoTerminal's OHLCV endpoint returns price/volume per candle but not
// historical pool depth, so the replay posts this real (but not
// per-candle-historical) figure as `dex_liquidity` on every tick -- the
// pool's actual reserve depth read via GeckoTerminal's pool-search
// endpoint at build time. This is a disclosed simplification: real
// number, wrong axis (current depth standing in for point-in-time
// historical depth), not a fabricated one.
export const REPLAY_POOL_LIQUIDITY_USD = 252_611.93;

export interface HistoricalCandle {
  timestamp: number; // unix seconds, UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

export interface HistoricalDataset {
  source: AnchorSource;
  network: string;
  poolAddress: string;
  fetchedAtUtc: string;
  fridayCloseUtc: string;
  mondayOpenUtc: string;
  candles: HistoricalCandle[];
}
