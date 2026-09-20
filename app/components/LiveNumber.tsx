"use client";

import { useLive } from "@/components/LiveProvider";
import { useCountUp } from "@/lib/useCountUp";
import { PRICE_SCALE } from "@/lib/constants";

/** A live on-chain price (Borrow-Limit or Liquidation), read from the shared
 * provider. Shows a skeleton until the real value has loaded, never a made-up one. */
export function LiveNumber({ kind, className }: { kind: "borrowLimit" | "liquidation"; className?: string }) {
  const { vigil } = useLive();
  const rs = vigil.regimeState;
  const micro = rs ? Number(kind === "borrowLimit" ? rs.borrowLimitPrice : rs.liquidationPrice) : null;
  const shown = useCountUp(micro === null ? null : micro / PRICE_SCALE);
  if (!vigil.configured) return <span className={className}>unavailable</span>;
  if (shown === null) return <span className="skeleton" role="status" aria-label="Loading price" />;
  return <span className={className}>${shown.toFixed(2)}</span>;
}
