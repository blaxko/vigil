"use client";

import { usePythMarketHours } from "@/lib/usePythMarketHours";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtUtc(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]} ${hh}:${mm} UTC`;
}

/**
 * One row showing Pyth's live AAPL market-hours status, clearly labelled
 * as market-hours metadata (not price data). If `onchainIsOpen` is passed
 * and disagrees with Pyth, says so plainly -- the on-chain flag is set by
 * hand in demo mode, so a mismatch is expected and disclosed, not hidden.
 */
export function PythMarketRow({ onchainIsOpen }: { onchainIsOpen?: boolean | null }) {
  const { status, data } = usePythMarketHours();

  let badge: React.ReactNode;
  if (status === "loading") {
    badge = <span className="badge closed">Loading&hellip;</span>;
  } else if (status === "error" || !data) {
    badge = <span className="badge closed">Unavailable</span>;
  } else if (data.isOpen) {
    badge = <span className="badge open">Open &middot; closes {fmtUtc(data.nextClose)}</span>;
  } else {
    badge = <span className="badge closed">Closed &middot; opens {fmtUtc(data.nextOpen)}</span>;
  }

  const mismatch = data && onchainIsOpen !== undefined && onchainIsOpen !== null && data.isOpen !== onchainIsOpen;

  return (
    <>
      <div className="row">
        <span className="label">Pyth market hours (AAPL)</span>
        {badge}
      </div>
      <div className="gloss">
        Live from Pyth (Hermes). Market-hours metadata only &mdash; not a price.
        {mismatch && (
          <>
            {" "}
            <span style={{ color: "var(--amber)" }}>
              The on-chain flag is set by hand in demo mode, so it differs from Pyth right now; a keeper would sync them.
            </span>
          </>
        )}
      </div>
    </>
  );
}
