import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { LiveNumber } from "@/components/LiveNumber";
import { ReplaySparkChart } from "@/components/ReplaySparkChart";

/* ------------------------------------------------------------------ */
/* Deployment status, directly under the hero                          */
/* ------------------------------------------------------------------ */

export function DeploymentStatus() {
  return (
    <div className="lp-container status-wrap">
      <div className="status-bar">
        <span className="status-badge">Devnet</span>
        <p className="status-text">
          Test tokens with no real value. Market hours are set manually and prices come from a reference stored on-chain
          from the Sept 11&ndash;14 replay, not a live feed. Not audited.
        </p>
        <details className="status-details">
          <summary>Details</summary>
          <p>
            Vigil&apos;s oracle takes market hours as an input, and a keeper watching real exchange hours would
            normally supply it. This deployment has no keeper, so the open/closed flag is set by hand and Pyth&apos;s
            live schedule is shown beside it. With the market set to closed, prices come from the closed-market path: the
            oracle blends its last anchor with a DEX reference price stored on-chain from the Sept 11&ndash;14 replay,
            and Borrow refreshes it. No Pyth price account is read. A mock Pyth program is configured as the trusted
            receiver and was used only for the replay&apos;s warm-up and reopen ticks. The pricing math, the position
            accounting and every transaction run on the deployed programs.
          </p>
        </details>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. The mechanism                                                    */
/* ------------------------------------------------------------------ */

export function MechanismSection() {
  return (
    <section className="lp-section section-major band-inset" id="pricing">
      <div className="lp-container">
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">How pricing works</span>
            <h2 className="lp-section-title">Two prices, moving in opposite directions</h2>
            <p className="lp-section-lead">
              Over-borrowing and unjust liquidation are opposite risks, so they never share one number.
            </p>
          </div>
        </Reveal>

        <div className="tag-grid two">
          <Reveal>
            <article className="tag-card">
              <span className="tag tag-green">Borrow-Limit Price</span>
              <h3 className="tag-card-title">Tightens through closures</h3>
              <p className="tag-card-body">
                The conservative price that sizes how much you can borrow, so it never chases a thin weekend
                market upward.
              </p>
              <div className="tag-card-live">
                <span>On-chain now</span>
                <LiveNumber kind="borrowLimit" className="c-green" />
              </div>
            </article>
          </Reveal>
          <Reveal delay={80}>
            <article className="tag-card">
              <span className="tag tag-blue">Liquidation Price</span>
              <h3 className="tag-card-title">Widens through closures</h3>
              <p className="tag-card-body">
                The forgiving price that decides liquidation, so a brief weekend dip cannot liquidate you
                unfairly.
              </p>
              <div className="tag-card-live">
                <span>On-chain now</span>
                <LiveNumber kind="liquidation" className="c-blue" />
              </div>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2. The proof                                                        */
/* ------------------------------------------------------------------ */

export function ProofBand() {
  return (
    <section className="proof-band section-major" id="proof">
      <div className="proof-glow" aria-hidden="true" />
      <div className="lp-container" style={{ position: "relative", zIndex: 1 }}>
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">Real data</span>
            <h2 className="lp-section-title">One real weekend, replayed on-chain</h2>
            <p className="lp-section-lead">
              The Friday-close-to-Monday-open window of Sept 11&ndash;14, 2026, run through the deployed programs
              on real market data.
            </p>
          </div>
        </Reveal>

        <Reveal>
          <div className="proof-chart">
            <ReplaySparkChart />
          </div>
        </Reveal>

        <div className="lp-cta-row" style={{ marginTop: 34, marginBottom: 0 }}>
          <Link href="/replay" className="btn-outline">
            See the full replay
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. The app, with the user sequence                                  */
/* ------------------------------------------------------------------ */

const JOURNEY = [
  { n: "01", t: "Deposit", d: "Put up tokenized AAPLx as collateral without selling it." },
  { n: "02", t: "Borrow", d: "Draw USDC against it, including on a Saturday." },
  { n: "03", t: "Hold through the closure", d: "Both prices adjust as it goes on, and your position is checked against the wider one." },
  { n: "04", t: "Repay and withdraw", d: "Repay any amount and take your AAPLx back." },
];

export function AppShowcase() {
  return (
    <section className="lp-section section-major" id="product">
      <div className="lp-container">
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">The product</span>
            <h2 className="lp-section-title">What you actually do</h2>
          </div>
        </Reveal>

        <div className="app-stage">
          <Reveal>
            <ol className="journey">
              {JOURNEY.map((s) => (
                <li key={s.n}>
                  <span className="journey-n">{s.n}</span>
                  <div>
                    <b>{s.t}</b>
                    <span>{s.d}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>

          <Reveal delay={80}>
            <div className="app-shots">
              <figure className="browser-frame">
                <div className="browser-bar" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <em>vigil &middot; dashboard</em>
                </div>
                <img
                  src="/img/dashboard-desktop.webp"
                  width={1920}
                  height={1978}
                  loading="lazy"
                  alt="The Vigil dashboard with a connected wallet and an open position: 3 AAPLx deposited, $150 borrowed, a health factor of 6.72 with the liquidation trigger and what is still available to borrow, above the deposit, borrow, repay and withdraw forms."
                />
              </figure>
              <figure className="phone-frame">
                <img
                  src="/img/dashboard-mobile.webp"
                  width={780}
                  height={1520}
                  loading="lazy"
                  alt="The same dashboard on a phone: the position summary with deposited collateral, debt, health factor, liquidation trigger and available-to-borrow."
                />
              </figure>
            </div>
          </Reveal>
        </div>

        <div className="lp-cta-row" style={{ marginTop: 34, marginBottom: 0 }}>
          <Link href="/app" className="btn-gradient">
            Open the dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Secondary: FAQ + deployment status                                  */
/* ------------------------------------------------------------------ */

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is Vigil?",
    a: (
      <>
        A lending market for tokenized stocks on Solana. You deposit a tokenized stock as collateral and borrow
        USDC against it. Because stocks stop trading at night and on weekends, Vigil prices collateral with two
        numbers that move in opposite directions while the market is closed, instead of freezing one.
      </>
    ),
  },
  {
    q: "Is real money involved?",
    a: (
      <>
        No. This runs on Solana devnet. The AAPLx is a test token you mint from the faucet, the USDC is a mock
        token, and devnet SOL has no value. Nothing here can gain or lose real funds.
      </>
    ),
  },
  {
    q: "How do the two prices update?",
    a: (
      <>
        Each oracle update moves both prices a bounded fraction of the way toward their targets, by at most 3% per
        update, with the Borrow-Limit Price moving more slowly than the Liquidation Price. Anyone can trigger an
        update, and this deployment triggers one just before each borrow, so the prices drift and then settle as
        updates land.
      </>
    ),
  },
  {
    q: "How does Vigil use Pyth?",
    a: (
      <>
        The oracle program is built around Pyth&apos;s price, confidence interval, staleness, feed and verification
        checks, and live Pyth data supplies market hours on the site. In this deployment the market is set to closed,
        so prices come from the stored replay reference and no Pyth price account is read. A mock Pyth program, which
        writes the same account layout, fed the replay&apos;s warm-up and reopen ticks, because Pyth&apos;s price endpoints
        need an API key and its AAPL price account on devnet was last updated on July 2.
      </>
    ),
  },
  {
    q: "What isn't built yet?",
    a: (
      <>
        <p>
          Vigil is a borrowing market today. The USDC it lends is a mock balance seeded by the deployer, so there is no
          lender deposit flow and no interest accrues. A liquidation repays a position&apos;s full debt, and any shortfall
          beyond a position&apos;s collateral is not socialized.
        </p>
        <p>
          Liquidations can currently cost the liquidator money. Measured on devnet in an isolated market with this
          reserve&apos;s parameters (90% LTV, 92% threshold, 5% bonus): a max-LTV position opened at a $373 price became
          liquidatable when the market was $333 and the Liquidation Price, which lags the market, was $363.94.
          Liquidating it cost the liquidator 3.93%: $335.69 USDC paid for $322.51 of AAPLx (
          <a
            href="https://explorer.solana.com/tx/2o5kkshuvjJLD6UGURUvZde49HcTdk5czH4sLAPqyiqvQ3EUjGyKxACdqbTg6sfP3HvhRzm3eo5HRN6jsVWJofBD?cluster=devnet"
            target="_blank"
            rel="noreferrer"
            className="inline-link"
          >
            2o5kks&hellip;JofBD
          </a>
          ). A liquidation only pays once the Liquidation Price is at or below the market price divided by 0.95 ($350.53
          in that case), so a liquidator has no reason to act until then. While the market is set to closed, the
          Liquidation Price stays above the Borrow-Limit Price, so a position borrowed within the limit isn&apos;t
          liquidatable at all.
        </p>
        <p>
          A live keeper, one that posts a live DEX price and sets the market regime from Pyth&apos;s published schedule, is
          the known next step and isn&apos;t built: while that schedule says open, the oracle&apos;s open path needs a real
          Pyth AAPL price account, and Pyth&apos;s AAPL account on devnet was last updated on July 2.
        </p>
      </>
    ),
  },
];

export function DetailsSection() {
  return (
    <section className="lp-section section-minor" id="faq">
      <div className="lp-container">
        <Reveal>
          <div className="lp-section-head minor-head">
            <h2 className="lp-section-title">Questions</h2>
          </div>
        </Reveal>

        <div className="faq-list">
          {FAQ.map((f) => (
            <details className="faq-item" key={f.q}>
              <summary>{f.q}</summary>
              <div className="faq-answer">{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Closing CTA pair                                                    */
/* ------------------------------------------------------------------ */

export function CtaPair() {
  return (
    <section className="lp-section section-minor cta-section" id="try-it">
      <div className="lp-container">
        <Reveal>
          <div className="cta-card">
            <h2 className="cta-title">Try it on devnet</h2>
            <p>Connect a wallet, get test AAPLx, and borrow against it.</p>
            <div className="lp-cta-row" style={{ marginBottom: 0 }}>
              <Link href="/app" className="btn-gradient">
                Launch App
              </Link>
              <a href="https://github.com/blaxko/vigil" target="_blank" rel="noreferrer" className="btn-outline">
                GitHub
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
