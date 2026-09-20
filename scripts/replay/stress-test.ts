/**
 * HYPOTHETICAL stress test: what would a Monday gap-down do to positions
 * opened at the maximum LTV, given the widened Liquidation Price Vigil is
 * carrying at the end of a closed weekend?
 *
 * This is NOT historical and NOT an on-chain replay. Everything here is
 * computed from (a) the real reserve parameters read from the deployed devnet
 * Reserve account, (b) the real prices the Sept 11-14 replay actually produced,
 * (c) the deployed programs' constants, and (d) ONE hypothetical input: the
 * size of the gap. It never touches the chain except to read the reserve.
 *
 * MODEL (deliberately simple, every assumption is written to the output):
 *  - A borrower opened a position at the replay's PEAK Borrow-Limit Price at
 *    the reserve's MAX LTV (the worst case the reserve allows). Debt per unit
 *    of collateral: D = maxLtv * borrowLimitPeak.
 *  - Monday's reopen print is  P = fridayClose * (1 - gap), and the price then
 *    stays at P (no further move; the lag section prices what a further move
 *    would add).
 *  - "Bad debt if unliquidated" = max(0, D - P) per unit, as a share of D.
 *  - The protocol treats a position as liquidatable when
 *      D >= liquidationThreshold * LiquidationPrice        (health.rs)
 *    so what matters is how many post-reopen updates the Liquidation Price
 *    needs to fall far enough. It starts at the weekend-end value and moves by
 *    ema_step(15% of the gap) each update, clamped to +/-50% on the FIRST
 *    post-reopen update and +/-3% afterwards (regime_oracle math.rs and
 *    update_price.rs). Target on the open path = price + conf; conf is
 *    assumed 0 here (optimistic).
 *  - A liquidator repays the whole debt and receives min(1, (1+bonus)*D/L)
 *    units (liquidate.rs / health.rs). They only act if the value received at
 *    the TRUE price P is at least D; when P < D nobody can profit, at any L.
 *
 * NOT MODELLED: interest, oracle confidence, slippage/market depth, partial
 * liquidation, other borrowers, keeper latency (the lag is reported in
 * UPDATES, not minutes), or any move after the gap.
 *
 * Usage: npm run replay:stress   (needs devnet RPC to read the Reserve)
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import lendingIdl from "../../app/lib/idl/lending_market.json";

// regime_oracle::math constants (programs/regime_oracle/src/math.rs)
const LIQUIDATION_ALPHA_BPS = 1500;
const NORMAL_MAX_MOVE_BPS = 300;
const REOPEN_MAX_MOVE_BPS = 5000;

const GAPS: { gapPct: number; label: string; note?: string }[] = [
  { gapPct: 5, label: "5%" },
  { gapPct: 10, label: "10%" },
  { gapPct: 13.0, label: "13.0%", note: "size of AAPL's Mar 16 2020 open" },
  { gapPct: 15, label: "15%" },
  { gapPct: 20, label: "20%" },
];

interface Comparison {
  fridayCloseAnchorUsd: number;
  vigilBorrowLimitRangeUsd: [number, number];
  points: { vigilBorrowLimitUsd: number; vigilLiquidationUsd: number }[];
}

/** One post-reopen update of the Liquidation Price (mirrors update_price.rs). */
function stepLiquidation(current: number, target: number, firstUpdateAfterReopen: boolean): number {
  const alpha = LIQUIDATION_ALPHA_BPS / 10_000;
  const eased = target >= current ? current + (target - current) * alpha : current - (current - target) * alpha;
  const maxMove = (firstUpdateAfterReopen ? REOPEN_MAX_MOVE_BPS : NORMAL_MAX_MOVE_BPS) / 10_000;
  return Math.min(current * (1 + maxMove), Math.max(current * (1 - maxMove), eased));
}

async function readReserve() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "devnet-config.json"), "utf-8"));
  const connection = new Connection(config.rpc, "confirmed");
  const provider = new anchor.AnchorProvider(connection, { publicKey: Keypair.generate().publicKey } as any, {});
  const program = new anchor.Program(lendingIdl as anchor.Idl, provider);
  const lendingProgramId = new PublicKey(config.lendingMarketProgramId);
  const mint = new PublicKey(config.collateralMint);
  const [reserve] = PublicKey.findProgramAddressSync([Buffer.from("reserve"), mint.toBuffer()], lendingProgramId);
  const r: any = await (program.account as any).reserve.fetch(reserve);
  return {
    maxLtvBps: Number(r.maxLtvBps),
    liquidationThresholdBps: Number(r.liquidationThresholdBps),
    liquidationBonusBps: Number(r.liquidationBonusBps),
    reserveAddress: reserve.toBase58(),
  };
}

async function main() {
  const cmp: Comparison = JSON.parse(fs.readFileSync(path.join(__dirname, "comparison-output.json"), "utf-8"));
  const reserve = await readReserve();

  const ltv = reserve.maxLtvBps / 10_000;
  const thr = reserve.liquidationThresholdBps / 10_000;
  const bonus = reserve.liquidationBonusBps / 10_000;

  const F = cmp.fridayCloseAnchorUsd;
  const borrowLimitPeak = cmp.vigilBorrowLimitRangeUsd[1];
  // last weekend tick before the reopen tick
  const weekendEnd = cmp.points[cmp.points.length - 2];
  const L0 = weekendEnd.vigilLiquidationUsd;
  const D = ltv * borrowLimitPeak; // debt per unit of collateral
  const eligibleBelowL = D / thr; // position is liquidatable once L <= this

  const scenarios = GAPS.map(({ gapPct, label, note }) => {
    const P = F * (1 - gapPct / 100);
    const shortfallPerUnit = Math.max(0, D - P);
    const unitsPer1MDebt = 1_000_000 / D;

    // Walk the post-reopen updates. Two different moments matter:
    //  (1) FLAGGED: the protocol's health check first says "liquidatable"
    //      (D >= thr * L), which needs the Liquidation Price to fall far enough;
    //  (2) EXECUTABLE: a rational liquidator can also profit, i.e. the collateral
    //      they receive (min(1, (1+bonus)*D/L) units) is worth >= D at the TRUE
    //      price P. If P < D that never happens at any L: the position is
    //      insolvent and nobody can liquidate it profitably.
    let L = L0;
    let flaggedAt: number | null = null;
    let executableAt: number | null = null;
    for (let n = 1; n <= 500 && executableAt === null; n++) {
      L = stepLiquidation(L, P, n === 1);
      const flagged = D >= thr * L;
      if (flagged && flaggedAt === null) flaggedAt = n;
      if (flagged) {
        const unitsReceived = Math.min(1, ((1 + bonus) * D) / L);
        if (unitsReceived * P >= D) executableAt = n;
      }
      if (n > 60 && flaggedAt === null) break; // price never gets it flagged (a healthy position)
    }
    const healthyAtTruePrice = P >= eligibleBelowL;
    const insolvent = P < D;

    return {
      gapPct,
      label,
      note: note ?? null,
      truePriceUsd: P,
      collateralValueVsDebtPct: (P / D - 1) * 100, // + = cushion, - = shortfall
      badDebtPer1MDebtUsd: shortfallPerUnit * unitsPer1MDebt,
      badDebtPctOfDebt: (shortfallPerUnit / D) * 100,
      // Protocol view at the weekend-end Liquidation Price (before any post-reopen update)
      flaggedLiquidatableAtWeekendEndPrice: D >= thr * L0,
      // Lag introduced by the fast-but-not-instant Liquidation Price:
      healthyAtTruePrice,
      insolventAtTruePrice: insolvent,
      updatesUntilFlaggedLiquidatable: flaggedAt,
      // null + insolvent = a liquidator can never profit, at any Liquidation Price
      updatesUntilLiquidationExecutable: executableAt,
      // If price keeps falling during that lag, each further 1% adds this much per $1M debt:
      extraBadDebtPerFurther1PctFallPer1MDebtUsd: P * 0.01 * unitsPer1MDebt,
    };
  });

  const ltvSensitivity = [0.9, 0.75, 0.6].map((l) => ({
    maxLtvPct: l * 100,
    insolvencyGapPct: (1 - (l * borrowLimitPeak) / F) * 100,
    isDeployedConfig: Math.abs(l - ltv) < 1e-9,
  }));

  const out = {
    hypothetical: true,
    generatedAt: new Date().toISOString(),
    reserve,
    inputs: {
      fridayCloseUsd: F,
      positionOpenedAtBorrowLimitUsd: borrowLimitPeak,
      debtPerUnitCollateralUsd: D,
      liquidationPriceAtWeekendEndUsd: L0,
      positionFlaggedLiquidatableOnceLiquidationPriceAtOrBelowUsd: eligibleBelowL,
      insolventWhenTruePriceBelowUsd: D,
      insolvencyGapPct: (1 - D / F) * 100,
      program: { liquidationAlphaBps: LIQUIDATION_ALPHA_BPS, normalMaxMoveBps: NORMAL_MAX_MOVE_BPS, reopenMaxMoveBps: REOPEN_MAX_MOVE_BPS },
    },
    references: [
      {
        label: "Apple (AAPL), Fri Mar 13 2020 close to Mon Mar 16 2020 open",
        gapPct: 13.0,
        detail: "split-adjusted: close $67.05, next open $58.36 (-13.0%), next close $58.42 (-12.9%)",
        source: "https://www.statmuse.com/money/ask/apple-stock-price-march-2020",
        caveat: "third-party data aggregator; percentages are split-invariant",
      },
      {
        label: "Chainlink, 24/5 US equities guide",
        gapPct: null,
        detail: 'describes session-transition jumps as "typically 1-2%" with spikes of "10-20%+" in low-liquidity or news-driven conditions',
        source: "https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide",
        caveat: "descriptive of observed behaviour, not a threshold or a forecast",
      },
    ],
    assumptions: [
      "The borrower opened at the replay's peak Borrow-Limit Price at the reserve's maximum LTV: the worst case the reserve permits.",
      "Monday's reopen print is the Friday close times (1 - gap), and the price then stays there. Further moves are not modelled; the last column prices them per 1%.",
      "The Liquidation Price starts at its weekend-end value and moves by the deployed programs' update rule (15% of the gap per update; 50% clamp on the first post-reopen update, 3% after). Oracle confidence is assumed to be zero.",
      "Whole-position liquidation with the reserve's bonus, and a liquidator only acts if the collateral received is worth at least the debt at the true price.",
      "Not modelled: interest, slippage or market depth, partial liquidation, other borrowers, keeper latency (lag is counted in updates, not minutes).",
    ],
    scenarios,
    ltvSensitivity,
  };

  fs.writeFileSync(path.join(__dirname, "stress-output.json"), JSON.stringify(out, null, 2));

  console.log(`Reserve (deployed): max LTV ${reserve.maxLtvBps / 100}%, liquidation threshold ${reserve.liquidationThresholdBps / 100}%, bonus ${reserve.liquidationBonusBps / 100}%`);
  console.log(`Friday close $${F.toFixed(2)} | position opened at Borrow-Limit $${borrowLimitPeak.toFixed(2)} -> debt/unit $${D.toFixed(2)} | insolvent below $${D.toFixed(2)} (gap > ${out.inputs.insolvencyGapPct.toFixed(1)}%)`);
  console.log(`Weekend-end Liquidation Price $${L0.toFixed(2)}; flagged liquidatable once it falls to <= $${eligibleBelowL.toFixed(2)}`);
  for (const s of scenarios) {
    console.log(
      `  gap ${(s.label + (s.note ? " (" + s.note + ")" : "")).padEnd(44)} P=$${s.truePriceUsd.toFixed(2)} cushion ${s.collateralValueVsDebtPct.toFixed(1).padStart(6)}%  bad debt/$1M: $${s.badDebtPer1MDebtUsd.toFixed(0).padStart(7)}  ` +
        `flagged@weekend-end-L: ${s.flaggedLiquidatableAtWeekendEndPrice}  flagged-after: ${s.updatesUntilFlaggedLiquidatable}  executable-after: ${s.updatesUntilLiquidationExecutable}  insolvent: ${s.insolventAtTruePrice}`,
    );
  }
  console.log("LTV sensitivity (insolvency gap):", ltvSensitivity.map((x) => `${x.maxLtvPct}% -> ${x.insolvencyGapPct.toFixed(1)}%${x.isDeployedConfig ? " (deployed)" : ""}`).join(" | "));
  console.log("\nWrote scripts/replay/stress-output.json");
}

main().catch((e) => {
  console.error("stress-test failed:", e.message ?? e);
  process.exit(1);
});
