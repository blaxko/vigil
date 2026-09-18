"use client";

import { useEffect, useState } from "react";

/**
 * Real Pyth market-hours metadata for the AAPL equity feed, read from
 * Hermes' public price-feeds endpoint (no API key needed -- unlike the
 * price/Benchmarks endpoints, which return 401). This is *schedule
 * metadata only*: it says whether the feed's market is open and when it
 * next opens/closes. It is not a price and is not what the on-chain
 * oracle consumes -- the on-chain feed id is a separate, mock-fed one.
 */
const HERMES_FEEDS_URL = "https://hermes.pyth.network/v2/price_feeds?query=AAPL&asset_type=equity";
export const PYTH_AAPL_FEED_ID = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
const REFRESH_MS = 60_000;

export type PythMarketHours = {
  isOpen: boolean;
  /** Unix seconds. */
  nextOpen: number;
  /** Unix seconds. */
  nextClose: number;
};

export type PythMarketHoursState =
  | { status: "loading"; data: null }
  | { status: "ok"; data: PythMarketHours }
  | { status: "error"; data: null };

export function usePythMarketHours(): PythMarketHoursState {
  const [state, setState] = useState<PythMarketHoursState>({ status: "loading", data: null });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(HERMES_FEEDS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const feeds: { id: string; market_hours?: { is_open: boolean; next_open: number; next_close: number } }[] =
          await res.json();
        const feed = feeds.find((f) => f.id === PYTH_AAPL_FEED_ID);
        if (!feed?.market_hours) throw new Error("AAPL feed missing market_hours");
        if (cancelled) return;
        setState({
          status: "ok",
          data: {
            isOpen: feed.market_hours.is_open,
            nextOpen: feed.market_hours.next_open,
            nextClose: feed.market_hours.next_close,
          },
        });
      } catch {
        // Keep the last good reading if we have one; only flag an error
        // when there is nothing to show.
        if (!cancelled) setState((prev) => (prev.status === "ok" ? prev : { status: "error", data: null }));
      }
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return state;
}
