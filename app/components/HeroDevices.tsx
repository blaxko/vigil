"use client";

import React from "react";
import Link from "next/link";
import { useLive } from "@/components/LiveProvider";
import { LiveNumber } from "@/components/LiveNumber";
import { PythMarketRowView, PythStatusBadge, regimesDiffer } from "@/components/PythMarketRow";
import { ReplaySparkChart } from "@/components/ReplaySparkChart";

function Device({
  label,
  badge,
  tone = "green",
  children,
  className = "",
}: {
  label: string;
  badge: string;
  tone?: "green" | "violet" | "amber";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`device ${className}`} aria-label={label}>
      <header className="device-bar">
        <span className="device-label">{label}</span>
        <span className={`device-badge ${tone}`}>
          <i />
          {badge}
        </span>
      </header>
      <div className="device-body">{children}</div>
    </section>
  );
}

/**
 * Three real, data-driven views of the product side by side (not images):
 *  1. the dashboard's Market panel, read live from the deployed devnet program;
 *  2. the /replay chart, drawn from the real replay dataset;
 *  3. the demo-mode disclosure, with the live on-chain flag vs live Pyth row.
 * All of it reads from one shared <LiveProvider>, so it costs one RPC poll.
 */
export function HeroDevices() {
  const { vigil, pyth } = useLive();
  const rs = vigil.regimeState;
  const differ = regimesDiffer(pyth, rs ? rs.isOpen : null);

  const regimeBadge = rs ? (
    <span className={`badge badge-nowrap ${rs.isOpen ? "open" : "closed"}`}>{rs.isOpen ? "Open" : "Closed — Converging"}</span>
  ) : (
    <span className="skeleton" role="status" aria-label="Loading regime" />
  );

  return (
    <div className="device-wrap">
      <div className="device-row" role="region" aria-label="Live product views" tabIndex={0}>
        <Device label="Market" badge="Live · devnet" className="d-left">
          <div className="row">
            <span className="label">On-chain regime</span>
            {regimeBadge}
          </div>
          <PythMarketRowView state={pyth} onchainIsOpen={rs ? rs.isOpen : null} />
          <div className="row">
            <span className="label">Borrow-Limit Price</span>
            <LiveNumber kind="borrowLimit" className="value c-green" />
          </div>
          <div className="row">
            <span className="label">Liquidation Price</span>
            <LiveNumber kind="liquidation" className="value c-blue" />
          </div>
          <p className="device-foot">Read live from Vigil&apos;s deployed devnet program, not a mockup.</p>
        </Device>

        <Device label="Weekend replay" badge="Real data" tone="violet" className="d-mid">
          <ReplaySparkChart />
          <p className="device-foot">
            149 real on-chain ticks across the Sept 11&ndash;14 weekend.{" "}
            <Link href="/replay" className="inline-link">
              Open the full replay &rarr;
            </Link>
          </p>
        </Device>

        <Device label="Demo mode" badge="Disclosed" tone="amber" className="d-right">
          <span className="disclosure-tag">Disclosed design choice</span>
          <h3 className="device-title">Market hours are set by hand</h3>
          <p className="device-text">
            No keeper is running, so the on-chain open/closed flag is set manually. The pricing math, the positions and
            every transaction are the real deployed programs.
          </p>
          <div className="row">
            <span className="label">On-chain flag</span>
            {regimeBadge}
          </div>
          <div className="row">
            <span className="label">Pyth, live</span>
            <PythStatusBadge state={pyth} />
          </div>
          {differ && <p className="device-note">They differ right now. That is expected in demo mode, and it is shown, not hidden.</p>}
          <p className="device-foot">
            <a href="#faq" className="inline-link">
              What does demo mode mean? &darr;
            </a>
          </p>
        </Device>
      </div>
      <p className="device-swipe" aria-hidden="true">
        Swipe to see all three &rarr;
      </p>
    </div>
  );
}
