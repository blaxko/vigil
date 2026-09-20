"use client";

import React, { useEffect, useRef, useState } from "react";

interface ComparisonPoint {
  timestampUtc: string;
  dexPriceUsd: number;
  vigilBorrowLimitUsd: number;
  vigilLiquidationUsd: number;
  frozenPriceUsd: number;
  dexOnlyPriceUsd: number;
  bandOraclePriceUsd?: number;
}

interface BandSensitivity {
  bandPct: number;
  bandLowUsd: number;
  bandHighUsd: number;
  trippedTicks: number;
  totalTicks: number;
  longestHoldTicks: number;
  maxHeldVsDexPct: number;
  rangeUsd: [number, number];
  reopenJumpPct: number;
}

interface ComparisonData {
  fridayCloseAnchorUsd: number;
  mondayReopenAnchorUsd: number;
  dexRawRangeUsd: [number, number];
  dexRawSwingPct: number;
  vigilBorrowLimitRangeUsd: [number, number];
  vigilLiquidationRangeUsd: [number, number];
  frozenVaultDiscontinuousJumpPct: number;
  bandModel?: { drawnBandPct: number; referenceUsd: number; sensitivity: BandSensitivity[] };
  points: ComparisonPoint[];
}

const WIDTH = 760;
const HEIGHT = 320;
const PAD_LEFT = 56; // minimum; grows on narrow screens so scaled-up labels still fit
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;
const MIN_LABEL_PX = 11; // axis labels never render smaller than this on screen

function buildPath(
  points: ComparisonPoint[],
  key: keyof ComparisonPoint,
  min: number,
  max: number,
  padLeft: number,
): string {
  const innerW = WIDTH - padLeft - PAD_RIGHT;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  return points
    .map((p, i) => {
      const x = padLeft + (i / Math.max(points.length - 1, 1)) * innerW;
      const v = p[key] as number;
      const y = PAD_TOP + innerH - ((v - min) / (max - min || 1)) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function ComparisonChart() {
  const [data, setData] = useState<ComparisonData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(WIDTH);

  // The SVG scales with its container (viewBox), so a fixed font-size in SVG
  // units shrinks on phones. Track the rendered width so the labels can be
  // sized in SVG units that come out at MIN_LABEL_PX on screen.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setRenderedWidth(el.clientWidth || WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  useEffect(() => {
    fetch("/comparison-output.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return <div className="error">Could not load comparison data: {error}. Run `npm run replay:compare` and copy the output into app/public/.</div>;
  }
  if (!data) {
    // Same aspect ratio as the chart so the page doesn't jump when data arrives.
    return <div className="chart-skeleton" role="status" aria-label="Loading real replay comparison data" />;
  }

  const { points } = data;
  const band = data.bandModel;
  const hasBand = !!band && points.every((p) => typeof p.bandOraclePriceUsd === "number");
  const allValues = points.flatMap((p) => [
    p.vigilBorrowLimitUsd,
    p.vigilLiquidationUsd,
    p.frozenPriceUsd,
    p.dexOnlyPriceUsd,
    ...(hasBand ? [p.bandOraclePriceUsd as number] : []),
  ]);
  const min = Math.min(...allValues) * 0.98;
  const max = Math.max(...allValues) * 1.02;

  const drawnBandPct = band?.drawnBandPct ?? 1;
  const series: { key: keyof ComparisonPoint; color: string; label: string; dash?: string }[] = [
    { key: "dexOnlyPriceUsd", color: "var(--red)", label: "DEX-only vault (raw, undampened)" },
    { key: "frozenPriceUsd", color: "var(--amber)", label: "Frozen-price vault (Friday close, jumps at reopen)" },
    ...(hasBand
      ? [
          {
            key: "bandOraclePriceUsd" as keyof ComparisonPoint,
            color: "var(--violet)",
            dash: "6 4",
            label: `Fixed ±${drawnBandPct}% deviation-band oracle (circuit breaker, generic model)`,
          },
        ]
      : []),
    { key: "vigilLiquidationUsd", color: "var(--blue)", label: "Vigil Liquidation Price" },
    { key: "vigilBorrowLimitUsd", color: "var(--green)", label: "Vigil Borrow-Limit Price" },
  ];

  // SVG units per screen pixel; label font in SVG units = MIN_LABEL_PX * that
  // (never below the 11 the desktop layout already uses). The left gutter
  // grows to fit the widest label ("$367" ~ 4 glyphs at ~0.62em each).
  const unitsPerPx = WIDTH / Math.max(renderedWidth, 1);
  const labelSize = Math.max(11, MIN_LABEL_PX * unitsPerPx);
  const padLeft = Math.max(PAD_LEFT, Math.ceil(labelSize * 4 * 0.62) + 10);

  const drawn = band?.sensitivity.find((s) => s.bandPct === band.drawnBandPct);
  const otherBands = band?.sensitivity.filter((s) => s.bandPct !== band.drawnBandPct) ?? [];

  return (
    <div ref={wrapRef}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        style={{ height: "auto", display: "block", background: "var(--inset)", borderRadius: 8 }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = PAD_TOP + t * (HEIGHT - PAD_TOP - PAD_BOTTOM);
          const value = max - t * (max - min);
          return (
            <g key={t}>
              <line x1={padLeft} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} style={{ stroke: "var(--card-border)" }} strokeWidth={1} />
              <text x={4} y={y + labelSize * 0.35} style={{ fill: "var(--muted)" }} fontSize={labelSize}>
                ${value.toFixed(0)}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <path
            key={s.key}
            d={buildPath(points, s.key, min, max, padLeft)}
            fill="none"
            style={{ stroke: s.color }}
            strokeWidth={2}
            strokeDasharray={s.dash}
          />
        ))}
      </svg>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
        {series.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
            <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2, display: "inline-block" }} />
            {s.label}
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="section-title">What actually happened, from one real dataset</div>
        <div className="row">
          <span className="label">DEX raw swing through the weekend</span>
          <span className="value">
            ${data.dexRawRangeUsd[0].toFixed(2)} - ${data.dexRawRangeUsd[1].toFixed(2)} ({data.dexRawSwingPct.toFixed(1)}%)
          </span>
        </div>
        <div className="row">
          <span className="label">Vigil Borrow-Limit Price range</span>
          <span className="value">
            ${data.vigilBorrowLimitRangeUsd[0].toFixed(2)} - ${data.vigilBorrowLimitRangeUsd[1].toFixed(2)}
          </span>
        </div>
        <div className="row">
          <span className="label">Vigil Liquidation Price range</span>
          <span className="value">
            ${data.vigilLiquidationRangeUsd[0].toFixed(2)} - ${data.vigilLiquidationRangeUsd[1].toFixed(2)}
          </span>
        </div>
        <div className="row">
          <span className="label">Frozen-price vault's discontinuous jump at reopen</span>
          <span className="value">{data.frozenVaultDiscontinuousJumpPct.toFixed(2)}%</span>
        </div>

        {hasBand && drawn && (
          <>
            <div className="row-divider" />
            <div className="row">
              <span className="label">
                &plusmn;{drawn.bandPct}% band (${drawn.bandLowUsd.toFixed(2)}&ndash;${drawn.bandHighUsd.toFixed(2)}): breaker held the price on
              </span>
              <span className="value">
                {drawn.trippedTicks} of {drawn.totalTicks} ticks
              </span>
            </div>
            <div className="row">
              <span className="label">&hellip; held price at its worst vs the live DEX price</span>
              <span className="value">{drawn.maxHeldVsDexPct.toFixed(2)}% off</span>
            </div>
            <div className="row">
              <span className="label">Band oracle&apos;s step at Monday reopen</span>
              <span className="value">{drawn.reopenJumpPct.toFixed(2)}%</span>
            </div>
            <div className="row">
              <span className="label">Highest price the band oracle sizes borrowing on (Vigil Borrow-Limit peak)</span>
              <span className="value">
                ${drawn.rangeUsd[1].toFixed(2)} (${data.vigilBorrowLimitRangeUsd[1].toFixed(2)})
              </span>
            </div>
            {otherBands.map((o) => (
              <div className="row" key={o.bandPct}>
                <span className="label">
                  Same model at &plusmn;{o.bandPct}% (${o.bandLowUsd.toFixed(2)}&ndash;${o.bandHighUsd.toFixed(2)})
                </span>
                <span className="value">
                  {o.trippedTicks === 0 ? "never trips: identical to DEX-only" : `holds on ${o.trippedTicks} of ${o.totalTicks} ticks`}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {hasBand && (
        <details className="baseline-note">
          <summary>How the deviation-band baseline is defined, and where its width comes from</summary>
          <p>
            A generic circuit-breaker model, not a model of any specific protocol&apos;s implementation. It accepts the raw
            DEX price only while it stays within &plusmn;{drawnBandPct}% of the last live print (the Friday close). A
            reading outside the band trips the breaker and the last accepted price is held until a reading is back
            inside the band or the market reopens and a live print re-centres it. It is computed from the same real
            DEX data as the other baselines, not on-chain.
          </p>
          <p>
            Chainlink&apos;s{" "}
            <a
              href="https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide"
              target="_blank"
              rel="noreferrer"
              className="inline-link"
            >
              24/5 US equities guide
            </a>{" "}
            tells integrators to set deviation limits but prescribes no numeric band, leaving it to each protocol&apos;s
            risk appetite. Its only figures are descriptive: session-transition jumps are &ldquo;typically 1&ndash;2%&rdquo;,
            with spikes of &ldquo;10&ndash;20%+&rdquo;. The width here is therefore chosen <em>from</em> that range, not
            recommended by it. The narrow end (&plusmn;1%) is drawn; the wide end (&plusmn;2%) is reported above so the
            choice is visible. At &plusmn;2% the breaker never trips on this weekend and the line would sit exactly on
            the DEX-only line.
          </p>
        </details>
      )}
    </div>
  );
}
