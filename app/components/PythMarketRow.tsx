"use client";

import { usePythMarketHours, type PythMarketHoursState } from "@/lib/usePythMarketHours";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtUtc(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]} ${hh}:${mm} UTC`;
}

/** The status badge alone, so other surfaces (e.g. the landing page) can show it. */
export function PythStatusBadge({ state }: { state: PythMarketHoursState }) {
  const { status, data } = state;
  if (status === "loading") return <span className="badge closed">Loading&hellip;</span>;
  if (status === "error" || !data) return <span className="badge closed">Unavailable</span>;
  if (data.isOpen) {
    return (
      <span className="badge open">
        Open &middot; <span style={{ whiteSpace: "nowrap" }}>closes {fmtUtc(data.nextClose)}</span>
      </span>
    );
  }
  return (
    <span className="badge closed">
      Closed &middot; <span style={{ whiteSpace: "nowrap" }}>opens {fmtUtc(data.nextOpen)}</span>
    </span>
  );
}

/** True only when we HAVE Pyth's reading, know the on-chain flag, and they disagree. */
export function regimesDiffer(state: PythMarketHoursState, onchainIsOpen?: boolean | null): boolean {
  return !!state.data && onchainIsOpen !== undefined && onchainIsOpen !== null && state.data.isOpen !== onchainIsOpen;
}

/**
 * One row showing Pyth's live AAPL market-hours status, clearly labelled as
 * market-hours metadata (not price data). If `onchainIsOpen` is passed and
 * disagrees with Pyth, says so plainly: the on-chain flag is switched by hand
 * on devnet, so a mismatch is expected and disclosed, not hidden.
 *
 * `PythMarketRowView` takes the Pyth state as a prop (so a page can share one
 * fetch across several components); `PythMarketRow` fetches its own.
 */
export function PythMarketRowView({ state, onchainIsOpen }: { state: PythMarketHoursState; onchainIsOpen?: boolean | null }) {
  const mismatch = regimesDiffer(state, onchainIsOpen);
  return (
    <>
      <div className="row">
        <span className="label">Pyth market hours (AAPL)</span>
        <PythStatusBadge state={state} />
      </div>
      <div className="gloss">
        Live from Pyth (Hermes). This is the exchange schedule, not a price.
        {mismatch && (
          <>
            {" "}
            <span style={{ color: "var(--amber)" }}>
              Pricing mode is switched manually on devnet, so it currently differs from Pyth&apos;s schedule.
            </span>
          </>
        )}
      </div>
    </>
  );
}

export function PythMarketRow({ onchainIsOpen }: { onchainIsOpen?: boolean | null }) {
  const state = usePythMarketHours();
  return <PythMarketRowView state={state} onchainIsOpen={onchainIsOpen} />;
}
