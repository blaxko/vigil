import { ComparisonChart } from "@/components/ComparisonChart";

export default function ReplayPage() {
  return (
    <div className="page">
      <div className="header">
        <div className="title">Vigil — Weekend Replay</div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <span className="badge open" style={{ fontSize: 13, padding: "6px 14px" }}>
          Replaying Sept 11&ndash;14 2026 weekend &mdash; real historical data
        </span>
      </div>

      <div className="panel">
        <p style={{ color: "#8a90a2", fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          Every point below came from a real on-chain <code>update_price</code> transaction against
          Vigil&apos;s deployed devnet programs (149 ticks, 298 real signatures, all confirmed
          finalized &mdash; see the README), driven by real historical AAPLx/USDC trading data
          (GeckoTerminal) for the actual Friday-close-to-Monday-open window of Sept 11-14, 2026.
          Nothing on this page is synthetic or invented.
        </p>
      </div>

      <div className="panel" style={{ borderColor: "#e0a929" }}>
        <div className="section-title" style={{ color: "#e0a929" }}>
          Anchor price source: GeckoTerminal-derived, not Pyth Benchmarks
        </div>
        <p style={{ color: "#8a90a2", fontSize: 13, lineHeight: 1.5, margin: "4px 0 0" }}>
          The Friday-close and Monday-reopen anchor prices below are read from the real AAPLx/USDC
          DEX pool at the moment of NYSE close/open, not from Pyth&apos;s own historical Benchmarks
          API &mdash; that API returned 401 Unauthorized for every timestamp tested (an API-key
          gate, not a data-availability issue) at build time. This is a faithful stand-in (AAPLx is
          arbitraged against real AAPL during market hours, so its DEX price tracks Pyth&apos;s
          equity print closely at the boundary), not a literal Pyth read. Switching to real Pyth
          data once a key is available is a one-line change: set <code>SOURCE =
          &quot;pyth-benchmarks&quot;</code> in <code>scripts/replay/config.ts</code>. See that
          file for the full disclosure.
        </p>
      </div>

      <div className="panel">
        <ComparisonChart />
      </div>
    </div>
  );
}
