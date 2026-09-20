"use client";

import React, { useEffect, useState } from "react";

interface Scenario {
  gapPct: number;
  label: string;
  note: string | null;
  truePriceUsd: number;
  collateralValueVsDebtPct: number;
  badDebtPer1MDebtUsd: number;
  badDebtPctOfDebt: number;
  flaggedLiquidatableAtWeekendEndPrice: boolean;
  healthyAtTruePrice: boolean;
  insolventAtTruePrice: boolean;
  updatesUntilFlaggedLiquidatable: number | null;
  updatesUntilLiquidationExecutable: number | null;
  extraBadDebtPerFurther1PctFallPer1MDebtUsd: number;
}

interface StressData {
  hypothetical: boolean;
  generatedAt: string;
  reserve: { maxLtvBps: number; liquidationThresholdBps: number; liquidationBonusBps: number };
  inputs: {
    fridayCloseUsd: number;
    positionOpenedAtBorrowLimitUsd: number;
    debtPerUnitCollateralUsd: number;
    liquidationPriceAtWeekendEndUsd: number;
    positionFlaggedLiquidatableOnceLiquidationPriceAtOrBelowUsd: number;
    insolvencyGapPct: number;
  };
  references: { label: string; gapPct: number | null; detail: string; source: string; caveat: string }[];
  assumptions: string[];
  scenarios: Scenario[];
  ltvSensitivity: { maxLtvPct: number; insolvencyGapPct: number; isDeployedConfig: boolean }[];
}

const usd0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const usd2 = (n: number) => "$" + n.toFixed(2);

function executableText(s: Scenario): string {
  if (s.insolventAtTruePrice) return "never: collateral is worth less than the debt";
  if (s.updatesUntilLiquidationExecutable === null) return "not needed: still healthy";
  return `${s.updatesUntilLiquidationExecutable} updates`;
}

export function StressTest() {
  const [data, setData] = useState<StressData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/stress-output.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return <div className="error">Could not load stress-test data: {error}. Run `npm run replay:stress` and copy the output into app/public/.</div>;
  }
  if (!data) {
    return <div className="chart-skeleton" role="status" aria-label="Loading stress-test data" style={{ aspectRatio: "760 / 260" }} />;
  }

  const { reserve, inputs, scenarios, ltvSensitivity, references, assumptions } = data;
  const firstBadDebt = scenarios.find((s) => s.badDebtPer1MDebtUsd > 0);
  const lagScenarios = scenarios.filter((s) => !s.insolventAtTruePrice && s.updatesUntilLiquidationExecutable !== null);
  const lagMin = lagScenarios.length ? Math.min(...lagScenarios.map((s) => s.updatesUntilLiquidationExecutable as number)) : null;
  const lagMax = lagScenarios.length ? Math.max(...lagScenarios.map((s) => s.updatesUntilLiquidationExecutable as number)) : null;
  const refGap = scenarios.find((s) => s.note !== null);

  return (
    <div className="panel stress">
      <span className="stress-tag">Hypothetical &middot; not historical</span>
      <h2 className="stress-title">Stress test: a Monday gap-down against the widened Liquidation Price</h2>
      <p className="stress-lead">
        Nothing in this section is historical or on-chain. It asks: for a borrower who opened at the maximum LTV,
        what would a weekend gap cost, given the Liquidation Price Vigil is carrying into Monday? The only invented
        input is the size of the gap; the reserve parameters, the weekend prices and the update rule are the real
        deployed ones. It is computed by <code>npm run replay:stress</code>.
      </p>

      <div className="stress-findings">
        <div className="stress-finding">
          <div className="stress-finding-n">{inputs.insolvencyGapPct.toFixed(1)}%</div>
          <div className="stress-finding-t">
            gap at which a max-LTV position first owes more than its collateral is worth. The deployed demo reserve
            allows {reserve.maxLtvBps / 100}% LTV against a Borrow-Limit Price of {usd2(inputs.positionOpenedAtBorrowLimitUsd)}.
          </div>
        </div>
        <div className="stress-finding">
          <div className="stress-finding-n">Not the Liquidation Price</div>
          <div className="stress-finding-t">
            Past that gap nobody can liquidate at a profit at <em>any</em> Liquidation Price, so the bad debt below is
            set by the LTV and the gap. At {ltvSensitivity[1].maxLtvPct}% LTV it would start at{" "}
            {ltvSensitivity[1].insolvencyGapPct.toFixed(1)}%, at {ltvSensitivity[2].maxLtvPct}% at{" "}
            {ltvSensitivity[2].insolvencyGapPct.toFixed(1)}%.
          </div>
        </div>
        <div className="stress-finding">
          <div className="stress-finding-n">
            {lagMin !== null && lagMax !== null ? `${lagMin}–${lagMax} updates` : "Delay"}
          </div>
          <div className="stress-finding-t">
            is what the widened Liquidation Price ({usd2(inputs.liquidationPriceAtWeekendEndUsd)} at the end of the
            weekend) adds: updates before a liquidation can execute at the gaps where the position is still solvent.
            That delay is the extra exposure if the price keeps falling.
          </div>
        </div>
      </div>

      <div className="stress-grid">
        {scenarios.map((s) => (
          <div className={"stress-card" + (s.badDebtPer1MDebtUsd > 0 ? " loss" : "")} key={s.gapPct}>
            <div className="stress-card-head">
              {s.label} gap
              {s.note && <div className="stress-card-note">{s.note}</div>}
            </div>
            <div className="stress-row">
              <span>Price after gap</span>
              <b>{usd2(s.truePriceUsd)}</b>
            </div>
            <div className="stress-row">
              <span>Collateral vs debt</span>
              <b>{(s.collateralValueVsDebtPct >= 0 ? "+" : "") + s.collateralValueVsDebtPct.toFixed(1)}%</b>
            </div>
            <div className="stress-row">
              <span>Bad debt per $1M</span>
              <b>{s.badDebtPer1MDebtUsd > 0 ? usd0(s.badDebtPer1MDebtUsd) : "$0"}</b>
            </div>
            <div className="stress-row stack">
              <span>Liquidation can execute after</span>
              <b>{executableText(s)}</b>
            </div>
          </div>
        ))}
      </div>

      <details className="stress-note">
        <summary>How to read this, and where the gap sizes come from</summary>
        <p>
          &ldquo;Bad debt per $1M&rdquo; is the shortfall on $1M of debt if the position is left unliquidated at the
          post-gap price. &ldquo;Liquidation can execute after&rdquo; counts the oracle updates after the reopen until
          the health check flags the position (it needs the Liquidation Price to fall to about{" "}
          {usd2(inputs.positionFlaggedLiquidatableOnceLiquidationPriceAtOrBelowUsd)}) and a liquidator can also profit.
          Updates are counted, not timed, because this build runs no keeper. Every further 1% fall during that delay adds
          roughly {refGap ? usd0(refGap.extraBadDebtPerFurther1PctFallPer1MDebtUsd) : "$10k"} per $1M of insolvent debt.
        </p>
        <p>
          <strong>Why these gaps.</strong> The 13.0% row borrows its size from a real weekend: Apple closed Friday, March 13, 2020 at
          $67.05 and opened Monday, March 16 at $58.36 (split-adjusted), a &minus;13.0% gap, closing at &minus;12.9%.
          Only the size is taken from history; the scenario itself is hypothetical. The other rows bracket it. Chainlink&apos;s guidance separately describes session-transition spikes of
          &ldquo;10&ndash;20%+&rdquo; in thin or news-driven conditions.
        </p>
        <ul className="stress-refs">
          {references.map((r) => (
            <li key={r.source}>
              <a href={r.source} target="_blank" rel="noreferrer" className="inline-link">
                {r.label}
              </a>
              : {r.detail}. <span style={{ opacity: 0.8 }}>Caveat: {r.caveat}.</span>
            </li>
          ))}
        </ul>
        <p>
          <strong>Assumptions and what is not modelled.</strong>
        </p>
        <ul className="stress-refs">
          {assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {firstBadDebt && (
          <p>
            The deployed devnet reserve is configured at {reserve.maxLtvBps / 100}% max LTV and a{" "}
            {reserve.liquidationThresholdBps / 100}% liquidation threshold with a {reserve.liquidationBonusBps / 100}%
            liquidator bonus: aggressive for an equity, and a parameter, not a property of the oracle.
          </p>
        )}
      </details>
    </div>
  );
}
