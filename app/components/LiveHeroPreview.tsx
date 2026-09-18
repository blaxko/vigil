"use client";

import { useVigilState } from "@/lib/useVigilState";
import { useCountUp } from "@/lib/useCountUp";
import { PRICE_SCALE } from "@/lib/constants";
import { PythMarketRow } from "@/components/PythMarketRow";

function usdValue(micro: number | null): number | null {
  return micro === null ? null : micro / PRICE_SCALE;
}

export function LiveHeroPreview() {
  const { configured, regimeState } = useVigilState();

  const borrowLimitTarget = regimeState ? Number(regimeState.borrowLimitPrice) : null;
  const liquidationTarget = regimeState ? Number(regimeState.liquidationPrice) : null;
  const borrowLimit = useCountUp(usdValue(borrowLimitTarget));
  const liquidation = useCountUp(usdValue(liquidationTarget));

  if (!configured) {
    return (
      <div className="panel lp-hero-visual">
        <div className="error">No devnet deployment configured.</div>
      </div>
    );
  }

  const loaded = regimeState !== null;

  return (
    <div className="panel lp-hero-visual">
      <div className="section-title">Live on Devnet</div>
      <div className="row">
        <span className="label">On-chain regime</span>
        {loaded ? (
          <span className={`badge badge-nowrap ${regimeState!.isOpen ? "open" : "closed"}`}>
            {regimeState!.isOpen ? "Open" : "Closed — Converging"}
          </span>
        ) : (
          <span className="badge closed">Live preview loading&hellip;</span>
        )}
      </div>
      <PythMarketRow onchainIsOpen={regimeState ? regimeState.isOpen : null} />
      <div className="row">
        <span className="label">Borrow-Limit Price</span>
        <span className="value" style={{ color: "var(--green)" }}>
          {borrowLimit !== null ? `$${borrowLimit.toFixed(2)}` : "—"}
        </span>
      </div>
      <div className="row">
        <span className="label">Liquidation Price</span>
        <span className="value" style={{ color: "var(--blue)" }}>
          {liquidation !== null ? `$${liquidation.toFixed(2)}` : "—"}
        </span>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 12, marginBottom: 0 }}>
        Real values read live from Vigil&apos;s deployed devnet program, not a mockup.
      </p>
    </div>
  );
}
