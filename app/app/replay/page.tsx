import { ComparisonChart } from "@/components/ComparisonChart";
import { SiteNav } from "@/components/SiteNav";
import { StressTest } from "@/components/StressTest";
import comparison from "@/public/comparison-output.json";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Weekend replay",
  "One real weekend, Friday close to Monday open (Sept 11 to 14, 2026), replayed through Vigil's deployed programs: 63 on-chain price updates through the closure, against DEX-only, frozen-price and deviation-band baselines.",
);

export default function ReplayPage() {
  // Same convention as the landing hero: leave out the Monday reopen tick, so the
  // figures below describe the closure itself.
  const pts = comparison.points.slice(0, -1);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const borrowMove = (last.vigilBorrowLimitUsd / first.vigilBorrowLimitUsd - 1) * 100;
  const liquidationMove = (last.vigilLiquidationUsd / first.vigilLiquidationUsd - 1) * 100;
  const usd = (n: number) => "$" + n.toFixed(2);

  return (
    <>
      <SiteNav />
      <div className="page">
        <div className="glow-field">
          <div className="glow-blob left" />
          <div className="glow-blob right" />
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="page-head">
            <h1 className="page-title">Weekend replay</h1>
            <p className="page-sub">
              One real weekend, Friday close to Monday open, Sept 11&ndash;14, 2026, priced by Vigil and by the
              alternatives.
            </p>
          </div>

          <div className="status-bar replay-status">
            <span className="status-badge">Data</span>
            <p className="status-text">
              Real AAPLx/USDC trading data from GeckoTerminal. The Friday-close and Monday-reopen anchors come from the
              same DEX pool, because Pyth&apos;s historical API requires a key.
            </p>
            <details className="status-details">
              <summary>Details</summary>
              <p>
                Those anchors are read at the moment of NYSE close and open. Pyth&apos;s Benchmarks and Hermes historical
                endpoints returned 401 Unauthorized for every timestamp tested, a key gate rather than missing data. AAPLx
                is arbitraged against real AAPL during market hours, so its DEX price tracks Pyth&apos;s equity print
                closely at the boundary: a close stand-in, not a literal Pyth read. The replay harness can switch its
                anchor source to Pyth Benchmarks once a key is available.
              </p>
            </details>
          </div>

          <div className="panel">
            <p className="replay-lede">
              Over the closed weekend the raw DEX price swung {comparison.dexRawSwingPct.toFixed(1)}%. Vigil&apos;s
              Borrow-Limit Price tightened {Math.abs(borrowMove).toFixed(1)}% to {usd(last.vigilBorrowLimitUsd)} and its
              Liquidation Price widened {liquidationMove.toFixed(1)}% to {usd(last.vigilLiquidationUsd)}, so neither one
              depends on a single thin weekend market.
            </p>
            <p className="replay-sub">
              Every Vigil point is a real <code>update_price</code> transaction on the deployed devnet programs. The closure is
              63 ticks: the closing tick, 61 hourly ticks and the reopen. An earlier 86-tick warm-up walked the seeded
              $150 price to the real Friday close through the mock Pyth account. All 149 ticks (298 signatures) are
              confirmed finalized. The frozen-price, DEX-only and deviation-band lines are
              baselines computed from the same DEX data, models of how other approaches would have priced the weekend
              rather than on-chain venues.
            </p>
          </div>

          <div className="panel">
            <ComparisonChart />
          </div>

          <StressTest />
        </div>
      </div>
    </>
  );
}
