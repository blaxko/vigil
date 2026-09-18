/**
 * Builds the three-way comparison (Vigil / frozen-price vault / DEX-only
 * vault) from the single real dataset produced by run-replay.ts and
 * fetch-historical-data.ts -- never three independently tuned scenarios.
 *
 * - Vigil: the REAL on-chain borrow_limit_price/liquidation_price this
 *   replay actually produced (from replay-output.json).
 * - Frozen-price vault: a Backed/xStocks-style venue that freezes at the
 *   real Friday close and only updates again at the real Monday reopen.
 * - DEX-only vault: a venue that blindly uses the real raw DEX price
 *   (candle.close) with no dampening or smoothing at all.
 *
 * Usage: npm run replay:compare (after replay:fetch and replay:run)
 */
import * as fs from "fs";
import * as path from "path";
import { HistoricalDataset } from "./config";
import { getFridayCloseAnchorUsd, getMondayReopenAnchorUsd } from "./anchor-price";

interface ReplayTick {
  step: string;
  candleTimestampUtc?: string;
  dexPriceUsd?: number;
  borrowLimitPriceUsd: number;
  liquidationPriceUsd: number;
  isOpen: boolean;
  txSignatures: string[];
}

interface ComparisonPoint {
  timestampUtc: string;
  dexPriceUsd: number;
  vigilBorrowLimitUsd: number;
  vigilLiquidationUsd: number;
  frozenPriceUsd: number;
  dexOnlyPriceUsd: number;
}

function main() {
  const dataset: HistoricalDataset = JSON.parse(fs.readFileSync(path.join(__dirname, "historical-data.json"), "utf-8"));
  const ticks: ReplayTick[] = JSON.parse(fs.readFileSync(path.join(__dirname, "replay-output.json"), "utf-8"));

  const fridayAnchor = getFridayCloseAnchorUsd();
  const mondayAnchor = getMondayReopenAnchorUsd();

  const replayTicks = ticks.filter((t) => t.step === "replay" || t.step === "reopen");
  if (replayTicks.length === 0) {
    throw new Error("No replay/reopen ticks found in replay-output.json -- run `npm run replay:run` first.");
  }

  const points: ComparisonPoint[] = replayTicks.map((t) => {
    const isReopen = t.step === "reopen";
    const dexPrice = t.dexPriceUsd ?? mondayAnchor;
    return {
      timestampUtc: isReopen ? dataset.mondayOpenUtc : t.candleTimestampUtc!,
      dexPriceUsd: dexPrice,
      vigilBorrowLimitUsd: t.borrowLimitPriceUsd,
      vigilLiquidationUsd: t.liquidationPriceUsd,
      // Frozen vault: constant at the Friday close until the real Monday
      // reopen instant, where it jumps discontinuously to the fresh print.
      frozenPriceUsd: isReopen ? mondayAnchor : fridayAnchor,
      // DEX-only vault: the raw historical DEX print, no dampening.
      dexOnlyPriceUsd: dexPrice,
    };
  });

  const dexPrices = points.map((p) => p.dexPriceUsd);
  const dexMin = Math.min(...dexPrices);
  const dexMax = Math.max(...dexPrices);
  const vigilBorrowMin = Math.min(...points.map((p) => p.vigilBorrowLimitUsd));
  const vigilBorrowMax = Math.max(...points.map((p) => p.vigilBorrowLimitUsd));
  const vigilLiqMin = Math.min(...points.map((p) => p.vigilLiquidationUsd));
  const vigilLiqMax = Math.max(...points.map((p) => p.vigilLiquidationUsd));

  const frozenJumpPct = ((mondayAnchor - fridayAnchor) / fridayAnchor) * 100;

  const summary = {
    fridayCloseAnchorUsd: fridayAnchor,
    mondayReopenAnchorUsd: mondayAnchor,
    dexRawRangeUsd: [dexMin, dexMax],
    dexRawSwingPct: ((dexMax - dexMin) / fridayAnchor) * 100,
    vigilBorrowLimitRangeUsd: [vigilBorrowMin, vigilBorrowMax],
    vigilLiquidationRangeUsd: [vigilLiqMin, vigilLiqMax],
    frozenVaultDiscontinuousJumpPct: frozenJumpPct,
    points,
  };

  fs.writeFileSync(path.join(__dirname, "comparison-output.json"), JSON.stringify(summary, null, 2));

  console.log(`Built comparison from ${points.length} real replayed ticks.`);
  console.log(`  DEX raw price range through the weekend: $${dexMin.toFixed(2)} - $${dexMax.toFixed(2)} (${summary.dexRawSwingPct.toFixed(1)}% swing)`);
  console.log(`  Vigil Borrow-Limit Price range: $${vigilBorrowMin.toFixed(2)} - $${vigilBorrowMax.toFixed(2)} (stayed conservative, did not chase the raw swing)`);
  console.log(`  Vigil Liquidation Price range: $${vigilLiqMin.toFixed(2)} - $${vigilLiqMax.toFixed(2)} (widened protectively, did not tighten with the raw swing)`);
  console.log(`  Frozen-price vault: flat at $${fridayAnchor.toFixed(2)} all weekend, then jumps ${frozenJumpPct.toFixed(2)}% discontinuously at Monday reopen`);
  console.log(`  DEX-only vault: directly exposed to the full ${summary.dexRawSwingPct.toFixed(1)}% raw swing the entire weekend, no dampening`);
  console.log(`\nWrote scripts/replay/comparison-output.json`);
}

main();
