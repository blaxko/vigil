"use client";

import React, { useEffect, useRef, useState } from "react";

interface ComparisonPoint {
  timestampUtc: string;
  dexPriceUsd: number;
  vigilBorrowLimitUsd: number;
  vigilLiquidationUsd: number;
  frozenPriceUsd: number;
  dexOnlyPriceUsd: number;
}

interface ComparisonData {
  fridayCloseAnchorUsd: number;
  mondayReopenAnchorUsd: number;
  dexRawRangeUsd: [number, number];
  dexRawSwingPct: number;
  vigilBorrowLimitRangeUsd: [number, number];
  vigilLiquidationRangeUsd: [number, number];
  frozenVaultDiscontinuousJumpPct: number;
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
    return <div className="pending">Loading real replay comparison data...</div>;
  }

  const { points } = data;
  const allValues = points.flatMap((p) => [p.vigilBorrowLimitUsd, p.vigilLiquidationUsd, p.frozenPriceUsd, p.dexOnlyPriceUsd]);
  const min = Math.min(...allValues) * 0.98;
  const max = Math.max(...allValues) * 1.02;

  const series: { key: keyof ComparisonPoint; color: string; label: string }[] = [
    { key: "dexOnlyPriceUsd", color: "var(--red)", label: "DEX-only vault (raw, undampened)" },
    { key: "frozenPriceUsd", color: "var(--amber)", label: "Frozen-price vault (Friday close, jumps at reopen)" },
    { key: "vigilLiquidationUsd", color: "var(--blue)", label: "Vigil Liquidation Price" },
    { key: "vigilBorrowLimitUsd", color: "var(--green)", label: "Vigil Borrow-Limit Price" },
  ];

  // SVG units per screen pixel; label font in SVG units = MIN_LABEL_PX * that
  // (never below the 11 the desktop layout already uses). The left gutter
  // grows to fit the widest label ("$367" ~ 4 glyphs at ~0.62em each).
  const unitsPerPx = WIDTH / Math.max(renderedWidth, 1);
  const labelSize = Math.max(11, MIN_LABEL_PX * unitsPerPx);
  const padLeft = Math.max(PAD_LEFT, Math.ceil(labelSize * 4 * 0.62) + 10);

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
          <path key={s.key} d={buildPath(points, s.key, min, max, padLeft)} fill="none" style={{ stroke: s.color }} strokeWidth={2} />
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
      </div>
    </div>
  );
}
