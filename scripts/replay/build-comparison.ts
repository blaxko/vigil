/**
 * Builds the comparison (Vigil / frozen-price vault / DEX-only vault /
 * fixed deviation-band oracle) from the single real dataset produced by
 * run-replay.ts and fetch-historical-data.ts -- never independently tuned
 * scenarios.
 *
 * - Vigil: the REAL on-chain borrow_limit_price/liquidation_price this
 *   replay actually produced (from replay-output.json).
 * - Frozen-price vault: a Backed/xStocks-style venue that freezes at the
 *   real Friday close and only updates again at the real Monday reopen.
 * - DEX-only vault: a venue that blindly uses the real raw DEX price
 *   (candle.close) with no dampening or smoothing at all.
 * - Fixed deviation-band oracle: a generic circuit-breaker model (NOT a model
 *   of any specific protocol's implementation). It accepts the raw DEX price
 *   only while it stays within +/- BAND_PCT of the last live print (the Friday
 *   close); a reading outside the band trips the breaker and the last accepted
 *   price is held until a reading is back inside the band or the market
 *   reopens (a live print re-centres it).
 *
 * WHERE THE BAND WIDTH COMES FROM (read this before quoting it): Chainlink's
 * tokenized-equity documentation tells integrators to set deviation limits /
 * circuit breakers but prescribes NO numeric band and leaves thresholds to
 * each protocol's risk appetite. Its only figures are descriptive: session-
 * transition jumps are "typically 1-2%", with spikes of "10-20%+"
 * (https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide).
 * The band here is therefore chosen FROM that documented typical range, not
 * recommended by it: the narrow end (1%) is drawn, and the wide end (2%) is
 * reported alongside it so the choice is visible, not hidden.
 *
 * Usage: npm run replay:compare (after replay:fetch and replay:run)
 */
import * as fs from "fs";
import * as path from "path";
import { HistoricalDataset } from "./config";
import { getFridayCloseAnchorUsd, getMondayReopenAnchorUsd } from "./anchor-price";

/** Drawn on the chart. Narrow end of Chainlink's documented typical 1-2% session jump. */
const BAND_PCT = 1;
/** Every width reported in the summary (wide end of the same documented range included). */
const BAND_SENSITIVITY_PCTS = [1, 2];

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
  bandOraclePriceUsd: number;
}

interface BandRun {
  bandPct: number;
  prices: number[];
  trippedTicks: number;
  totalTicks: number;
  longestHoldTicks: number;
  maxHeldVsDexPct: number;
  rangeUsd: [number, number];
  reopenJumpPct: number;
}

/** Runs the circuit-breaker model over the real tick sequence. The final
 * point is the real Monday reopen, where a live print re-centres the oracle. */
function runBand(
  dexSeries: number[],
  isReopen: boolean[],
  referenceUsd: number,
  bandPct: number,
): BandRun {
  const lo = referenceUsd * (1 - bandPct / 100);
  const hi = referenceUsd * (1 + bandPct / 100);
  const prices: number[] = [];
  let tripped = 0;
  let hold = 0;
  let longestHold = 0;
  let maxHeldVsDex = 0;
  let last = dexSeries[0];
  for (let i = 0; i < dexSeries.length; i++) {
    const dex = dexSeries[i];
    if (isReopen[i]) {
      prices.push(dex); // live market again: accept the real print
      continue;
    }
    if (dex >= lo && dex <= hi) {
      last = dex;
      hold = 0;
    } else {
      tripped++;
      hold++;
      longestHold = Math.max(longestHold, hold);
      maxHeldVsDex = Math.max(maxHeldVsDex, (Math.abs(dex - last) / last) * 100);
    }
    prices.push(last);
  }
  const reopenIdx = isReopen.lastIndexOf(true);
  const beforeReopen = reopenIdx > 0 ? prices[reopenIdx - 1] : prices[prices.length - 1];
  const reopenPrice = reopenIdx >= 0 ? prices[reopenIdx] : beforeReopen;
  return {
    bandPct,
    prices,
    trippedTicks: tripped,
    totalTicks: dexSeries.length - isReopen.filter(Boolean).length,
    longestHoldTicks: longestHold,
    maxHeldVsDexPct: maxHeldVsDex,
    rangeUsd: [Math.min(...prices), Math.max(...prices)],
    reopenJumpPct: ((reopenPrice - beforeReopen) / beforeReopen) * 100,
  };
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

  const dexSeries = replayTicks.map((t) => t.dexPriceUsd ?? mondayAnchor);
  const reopenFlags = replayTicks.map((t) => t.step === "reopen");
  const bandRuns = BAND_SENSITIVITY_PCTS.map((pct) => runBand(dexSeries, reopenFlags, fridayAnchor, pct));
  const drawn = bandRuns.find((r) => r.bandPct === BAND_PCT)!;

  const points: ComparisonPoint[] = replayTicks.map((t, i) => {
    const isReopen = t.step === "reopen";
    const dexPrice = dexSeries[i];
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
      // Fixed deviation-band oracle (circuit breaker), see header comment.
      bandOraclePriceUsd: drawn.prices[i],
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
    bandModel: {
      drawnBandPct: BAND_PCT,
      referenceUsd: fridayAnchor,
      sensitivity: bandRuns.map((r) => ({
        bandPct: r.bandPct,
        bandLowUsd: fridayAnchor * (1 - r.bandPct / 100),
        bandHighUsd: fridayAnchor * (1 + r.bandPct / 100),
        trippedTicks: r.trippedTicks,
        totalTicks: r.totalTicks,
        longestHoldTicks: r.longestHoldTicks,
        maxHeldVsDexPct: r.maxHeldVsDexPct,
        rangeUsd: r.rangeUsd,
        reopenJumpPct: r.reopenJumpPct,
      })),
    },
    points,
  };

  fs.writeFileSync(path.join(__dirname, "comparison-output.json"), JSON.stringify(summary, null, 2));

  console.log(`Built comparison from ${points.length} real replayed ticks.`);
  console.log(`  DEX raw price range through the weekend: $${dexMin.toFixed(2)} - $${dexMax.toFixed(2)} (${summary.dexRawSwingPct.toFixed(1)}% swing)`);
  console.log(`  Vigil Borrow-Limit Price range: $${vigilBorrowMin.toFixed(2)} - $${vigilBorrowMax.toFixed(2)} (stayed conservative, did not chase the raw swing)`);
  console.log(`  Vigil Liquidation Price range: $${vigilLiqMin.toFixed(2)} - $${vigilLiqMax.toFixed(2)} (widened protectively, did not tighten with the raw swing)`);
  console.log(`  Frozen-price vault: flat at $${fridayAnchor.toFixed(2)} all weekend, then jumps ${frozenJumpPct.toFixed(2)}% discontinuously at Monday reopen`);
  console.log(`  DEX-only vault: directly exposed to the full ${summary.dexRawSwingPct.toFixed(1)}% raw swing the entire weekend, no dampening`);
  for (const r of bandRuns) {
    console.log(
      `  Deviation-band oracle +/-${r.bandPct}% around $${fridayAnchor.toFixed(2)}: breaker held the price on ${r.trippedTicks}/${r.totalTicks} ticks ` +
        `(longest hold ${r.longestHoldTicks}, held price up to ${r.maxHeldVsDexPct.toFixed(2)}% off the DEX), ` +
        `range $${r.rangeUsd[0].toFixed(2)}-$${r.rangeUsd[1].toFixed(2)}, reopen step ${r.reopenJumpPct.toFixed(2)}%`,
    );
  }
  console.log(`\nWrote scripts/replay/comparison-output.json`);
}

main();
