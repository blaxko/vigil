"use client";

import React, { useEffect, useState } from "react";

interface Point {
  dexOnlyPriceUsd: number;
  frozenPriceUsd: number;
  vigilBorrowLimitUsd: number;
  vigilLiquidationUsd: number;
}

const W = 320;
const H = 170;
const PAD = 8;

const SERIES: { key: keyof Point; color: string; label: string }[] = [
  { key: "dexOnlyPriceUsd", color: "var(--red)", label: "DEX-only" },
  { key: "frozenPriceUsd", color: "var(--amber)", label: "Frozen" },
  { key: "vigilLiquidationUsd", color: "var(--blue)", label: "Vigil Liquidation" },
  { key: "vigilBorrowLimitUsd", color: "var(--green)", label: "Vigil Borrow-Limit" },
];

/** A compact version of the /replay chart for the landing page. It loads the
 * same real dataset the full chart uses (public/comparison-output.json), so
 * what it draws is the actual replay, not an illustration. */
export function ReplaySparkChart() {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/comparison-output.json")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setPoints(d.points))
      .catch(() => setError(true));
  }, []);

  if (error) return <div className="spark-foot">The replay chart couldn&apos;t load. Refresh to try again.</div>;
  if (!points) return <div className="chart-skeleton" style={{ aspectRatio: `${W} / ${H}` }} role="status" aria-label="Loading replay chart" />;

  const all = points.flatMap((p) => SERIES.map((s) => p[s.key]));
  const min = Math.min(...all);
  const max = Math.max(...all);
  const path = (key: keyof Point) =>
    points
      .map((p, i) => {
        const x = PAD + (i / Math.max(points.length - 1, 1)) * (W - PAD * 2);
        const y = PAD + (H - PAD * 2) - ((p[key] - min) / (max - min || 1)) * (H - PAD * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Weekend replay: Vigil's two prices against a frozen price and the raw DEX price" style={{ display: "block", height: "auto", background: "var(--inset)", borderRadius: 10 }}>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1={PAD} x2={W - PAD} y1={PAD + t * (H - PAD * 2)} y2={PAD + t * (H - PAD * 2)} style={{ stroke: "var(--card-border)" }} />
        ))}
        {SERIES.map((s) => (
          <path key={s.key} d={path(s.key)} fill="none" style={{ stroke: s.color }} strokeWidth={1.8} />
        ))}
      </svg>
      <div className="spark-legend">
        {SERIES.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
