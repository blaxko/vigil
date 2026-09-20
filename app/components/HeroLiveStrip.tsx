"use client";

import Link from "next/link";
import { useLive } from "@/components/LiveProvider";
import { PythStatusBadge, regimesDiffer } from "@/components/PythMarketRow";
import { PRICE_SCALE } from "@/lib/constants";

/**
 * The "and it is running right now" proof under the hero chart: the same two
 * prices, read live from the deployed devnet program, plus the live Pyth
 * market-hours reading. Reads the shared <LiveProvider> poll, so it adds no
 * extra RPC traffic.
 */
export function HeroLiveStrip() {
  const { vigil, pyth } = useLive();
  const rs = vigil.regimeState;
  const differ = regimesDiffer(pyth, rs ? rs.isOpen : null);

  const borrow = rs ? Number(rs.borrowLimitPrice) / PRICE_SCALE : null;
  const liquidation = rs ? Number(rs.liquidationPrice) / PRICE_SCALE : null;
  const gap = borrow !== null && liquidation !== null ? liquidation - borrow : null;
  const money = (v: number | null) =>
    v === null ? <span className="skeleton" role="status" aria-label="Loading price" /> : `$${v.toFixed(2)}`;

  return (
    <div className="live-strip">
      <div className="live-strip-head">
        <span className="live-dot" aria-hidden="true" />
        Live on devnet, right now
      </div>

      <div className="live-strip-items">
        <div className="live-item">
          <span className="live-item-label">Borrow-Limit</span>
          <span className="live-item-value c-green">{money(borrow)}</span>
        </div>
        <div className="live-item">
          <span className="live-item-label">Liquidation</span>
          <span className="live-item-value c-blue">{money(liquidation)}</span>
        </div>
        <div className="live-item">
          <span className="live-item-label">Gap</span>
          <span className="live-item-value">{money(gap)}</span>
        </div>
        <div className="live-item wide">
          <span className="live-item-label">On-chain regime</span>
          {rs ? (
            <span className={`badge badge-nowrap ${rs.isOpen ? "open" : "closed"}`}>
              {rs.isOpen ? "Open" : "Closed — Converging"}
            </span>
          ) : (
            <span className="skeleton" role="status" aria-label="Loading regime" />
          )}
        </div>
        <div className="live-item wide">
          <span className="live-item-label">Pyth market hours (AAPL)</span>
          <PythStatusBadge state={pyth} />
        </div>
      </div>

      <p className="live-strip-foot">
        Read from Vigil&apos;s deployed devnet program. The Pyth row is live market-hours metadata, not a price.
        {differ && (
          <> <span className="c-amber">It differs from the on-chain flag right now &mdash; that is demo mode, and it is shown, not hidden.</span></>
        )}{" "}
        <Link href="/" className="inline-link">
          Open the dashboard &rarr;
        </Link>
      </p>
    </div>
  );
}
