"use client";

import React, { createContext, useContext } from "react";
import { useVigilState } from "@/lib/useVigilState";
import { usePythMarketHours, type PythMarketHoursState } from "@/lib/usePythMarketHours";

type Live = { vigil: ReturnType<typeof useVigilState>; pyth: PythMarketHoursState };

const LiveContext = createContext<Live | null>(null);

/**
 * ONE devnet poll and ONE Hermes poll for the whole landing page.
 *
 * `useVigilState` polls the RPC every 5 s per instance, so giving each live
 * card its own copy would multiply requests against the public devnet RPC by
 * the number of cards. Wrap the page once and let the cards read this.
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const vigil = useVigilState();
  const pyth = usePythMarketHours();
  return <LiveContext.Provider value={{ vigil, pyth }}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  const v = useContext(LiveContext);
  if (!v) throw new Error("useLive must be used inside <LiveProvider>");
  return v;
}
