"use client";

import React, { useEffect, useState } from "react";

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
const PAD_LEFT = 56;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;

function buildPath(points: ComparisonPoint[], key: keyof ComparisonPoint, min: number, max: number): string {
  const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  return points
    .map((p, i) => {
      const x = PAD_LEFT + (i / Math.max(points.length - 1, 1)) * innerW;
      const v = p[key] as number;
      const y = PAD_TOP + innerH - ((v - min) / (max - min || 1)) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function ComparisonChart() {
  const [data, setData] = useState<ComparisonData | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    { key: "dexOnlyPriceUsd", color: "#e24d4d", label: "DEX-only vault (raw, undampened)" },
    { key: "frozenPriceUsd", color: "#e0a929", label: "Frozen-price vault (Friday close, jumps at reopen)" },
    { key: "vigilLiquidationUsd", color: "#5b8cff", label: "Vigil Liquidation Price" },
    { key: "vigilBorrowLimitUsd", color: "#33c07a", label: "Vigil Borrow-Limit Price" },
  ];

  return (
    <div>
      <svg width={WIDTH} height={HEIGHT} style={{ maxWidth: "100%", background: "#0d0f15", borderRadius: 8 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = PAD_TOP + t * (HEIGHT - PAD_TOP - PAD_BOTTOM);
          const value = max - t * (max - min);
          return (
            <g key={t}>
              <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke="#232733" strokeWidth={1} />
              <text x={4} y={y + 4} fill="#8a90a2" fontSize={11}>
                ${value.toFixed(0)}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <path key={s.key} d={buildPath(points, s.key, min, max)} fill="none" stroke={s.color} strokeWidth={2} />
        ))}
      </svg>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
        {series.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8a90a2" }}>
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
