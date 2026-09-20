import comparison from "@/public/comparison-output.json";

/**
 * The hero visual: Vigil's two prices diverging through a real market closure.
 *
 * Every coordinate comes from the Sept 11-14 2026 replay that ran through the
 * deployed devnet programs (public/comparison-output.json) -- the same dataset
 * the /replay page draws. Nothing here is illustrative.
 *
 * Server component: the paths are computed at build time, so the hero costs no
 * client JS. The draw-on is pure CSS and is disabled under prefers-reduced-motion.
 *
 * All text lives in HTML, never in the SVG: SVG text scales with the viewBox and
 * would render ~5px on a phone (the same bug already fixed once on /replay).
 */

const W = 900;
const H = 448;
const PAD_T = 30;
// Wide right gutter: the end-of-closure labels sit there as HTML, and the
// dashed reopen marker gives the space a meaning at widths where they hide.
const PAD_R = 176;
const PAD_B = 30;
const PAD_L = 28;

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function HeroDivergence() {
  // Drop the final point: it is the Monday reopen tick, a different story from
  // the closure this chart is about. Keeping it would make the end labels
  // disagree with the summary figures below.
  const points = comparison.points.slice(0, -1);
  const n = points.length;

  const borrow = points.map((p) => p.vigilBorrowLimitUsd);
  const liquidation = points.map((p) => p.vigilLiquidationUsd);

  const lo = Math.min(...borrow) * 0.985;
  const hi = Math.max(...liquidation) * 1.015;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const x = (i: number) => PAD_L + (i / (n - 1)) * innerW;
  const y = (v: number) => PAD_T + innerH - ((v - lo) / (hi - lo)) * innerH;
  const path = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  // The wedge: out along Liquidation, back along Borrow-Limit, closed.
  const back = borrow
    .map((_, i) => n - 1 - i)
    .map((j) => `L${x(j).toFixed(1)},${y(borrow[j]).toFixed(1)}`)
    .join(" ");
  const wedge = `${path(liquidation)} ${back} Z`;

  const startGap = liquidation[0] - borrow[0];
  const endGap = liquidation[n - 1] - borrow[n - 1];
  const borrowMove = (borrow[n - 1] / borrow[0] - 1) * 100;
  const liquidationMove = (liquidation[n - 1] / liquidation[0] - 1) * 100;

  // End-label positions as percentages of the box, so HTML labels can sit on the
  // line ends and stay put at any width (the viewBox fixes the aspect ratio).
  const endX = pct(x(n - 1) / W);
  const borrowY = pct(y(borrow[n - 1]) / H);
  const liquidationY = pct(y(liquidation[n - 1]) / H);

  return (
    <figure className="hero-chart">
      <figcaption className="hero-chart-head">
        <span className="hero-chart-state">Market closed</span>
        <span>{n} real on-chain price updates</span>
      </figcaption>

      <div className="hero-chart-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`Through the closed market, Vigil's Borrow-Limit Price fell ${borrowMove.toFixed(
            1,
          )} percent to $${borrow[n - 1].toFixed(2)} while its Liquidation Price rose ${liquidationMove.toFixed(
            1,
          )} percent to $${liquidation[n - 1].toFixed(2)}, widening the gap between them from $${startGap.toFixed(
            2,
          )} to $${endGap.toFixed(2)}.`}
        >
          <defs>
            <linearGradient id="wedge-fill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--violet)" stopOpacity="0.04" />
              <stop offset="100%" stopColor="var(--violet)" stopOpacity="0.22" />
            </linearGradient>
          </defs>

          <path className="hero-wedge" d={wedge} fill="url(#wedge-fill)" />
          <line className="hero-marker" x1={x(n - 1)} x2={x(n - 1)} y1={PAD_T - 14} y2={H - PAD_B + 10} />
          <path className="hero-line hero-line-liq" d={path(liquidation)} pathLength={1} />
          <path className="hero-line hero-line-bl" d={path(borrow)} pathLength={1} />

          <circle className="hero-dot hero-dot-liq" cx={x(n - 1)} cy={y(liquidation[n - 1])} r={5} />
          <circle className="hero-dot hero-dot-bl" cx={x(n - 1)} cy={y(borrow[n - 1])} r={5} />
        </svg>

        <span className="hero-endlabel liq" style={{ left: endX, top: liquidationY }}>
          <b>${liquidation[n - 1].toFixed(2)}</b>
          Liquidation &middot; widens
        </span>
        <span className="hero-endlabel bl" style={{ left: endX, top: borrowY }}>
          <b>${borrow[n - 1].toFixed(2)}</b>
          Borrow-Limit &middot; tightens
        </span>
      </div>

      <div className="hero-axis">
        <span>Friday close</span>
        <span>Monday open</span>
      </div>

      <div className="hero-chips">
        <span className="hero-chip bl">
          <i />
          Borrow-Limit <b>{borrowMove.toFixed(1)}%</b>
        </span>
        <span className="hero-chip liq">
          <i />
          Liquidation <b>+{liquidationMove.toFixed(1)}%</b>
        </span>
        <span className="hero-chip gap">
          Gap <b>{(endGap / startGap).toFixed(0)}&times; wider</b>
        </span>
      </div>
    </figure>
  );
}
