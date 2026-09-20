import { ComparisonChart } from "@/components/ComparisonChart";
import { StressTest } from "@/components/StressTest";

export default function ReplayPage() {
  return (
    <div className="page">
      <div className="glow-field">
        <div className="glow-blob left" />
        <div className="glow-blob right" />
      </div>
      <div className="header" style={{ position: "relative", zIndex: 1 }}>
        <a href="/landing" className="title">
          Vigil<span className="title-sub">Weekend Replay</span>
        </a>
        <a href="/" className="hdr-link">
          &larr; Dashboard
        </a>
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ marginBottom: 16 }}>
          <span className="badge open" style={{ fontSize: 13, padding: "6px 14px" }}>
            Replaying Sept 11&ndash;14 2026 weekend &mdash; real historical data
          </span>
        </div>

        <div className="panel">
          <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5, margin: 0 }}>
            Every Vigil point below is a real on-chain <code>update_price</code> transaction against
            Vigil&apos;s deployed devnet programs (149 ticks, 298 real signatures, all confirmed
            finalized &mdash; see the README), driven by real historical AAPLx/USDC trading data
            (GeckoTerminal) for the actual Friday-close-to-Monday-open window of Sept 11&ndash;14, 2026.
            The frozen-price, DEX-only and deviation-band lines are baselines computed from that same
            real DEX data &mdash; models of how other approaches would have priced the same weekend, not
            on-chain venues. No data in this replay is invented.
          </p>
        </div>

        <div className="panel disclosure">
          <span className="disclosure-tag">Disclosed design choice</span>
          <h2 className="disclosure-title">149 real on-chain ticks, anchored to the live AAPLx pool</h2>
          <p className="disclosure-lead">
            Every tick is a finalized devnet transaction. The Friday-close and Monday-reopen anchors come
            from the real AAPLx/USDC DEX pool, because Pyth&apos;s historical Benchmarks API required an
            API key.
          </p>
          <details>
            <summary>Details</summary>
            <p>
              Those anchors are read at the moment of NYSE close/open. Pyth&apos;s Benchmarks and Hermes
              historical endpoints returned 401 Unauthorized for every timestamp tested at build time (a
              key gate, not missing data). AAPLx is arbitraged against real AAPL during market hours, so
              its DEX price tracks Pyth&apos;s equity print closely at the boundary &mdash; a faithful
              stand-in, not a literal Pyth read. With a key, switching is one line: set{" "}
              <code>SOURCE = &quot;pyth-benchmarks&quot;</code> in <code>scripts/replay/config.ts</code>.
            </p>
          </details>
        </div>

        <div className="panel">
          <ComparisonChart />
        </div>

        <StressTest />
      </div>
    </div>
  );
}
