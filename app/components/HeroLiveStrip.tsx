"use client";

import { useLive } from "@/components/LiveProvider";
import { PythStatusBadge, regimesDiffer } from "@/components/PythMarketRow";
import { PRICE_SCALE } from "@/lib/constants";

/**
 * The "and it is running right now" readout under the hero chart: the same two
 * prices, read live from the deployed devnet program, plus Pyth's live
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
        On-chain now
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
          <span className="live-item-label">Market hours, from Pyth</span>
          <PythStatusBadge state={pyth} />
        </div>
      </div>

      {differ && (
        <p className="live-strip-foot">
          Market hours are set manually here, so the on-chain flag currently differs from Pyth.
        </p>
      )}
    </div>
  );
}
