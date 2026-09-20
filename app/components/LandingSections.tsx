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
          Test tokens with no real value. Market hours are set manually in this deployment.
        </p>
        <details className="status-details">
          <summary>Details</summary>
          <p>
            Vigil&apos;s oracle takes market hours as an input. Feeding it automatically needs a
            continuously-running keeper watching real exchange hours, which is separate infrastructure from the
            on-chain programs, so the open/closed flag is set by hand here and Pyth&apos;s real market hours are
            shown beside it. Borrow also triggers an oracle refresh that re-posts a reference price stored on-chain
            from the Sept 11&ndash;14 replay, not a live one. The pricing math, the position accounting and every
            transaction are the real deployed programs.
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
                <span>Live now</span>
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
                <span>Live now</span>
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
  { n: "03", t: "Hold through the closure", d: "Pricing adapts on its own. Nothing for you to do." },
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
                  height={2166}
                  loading="lazy"
                  alt="The Vigil dashboard with a connected wallet: live market panel, a position of 8 AAPLx deposited with 3 USDC borrowed, and deposit, borrow and repay forms."
                />
              </figure>
              <figure className="phone-frame">
                <img
                  src="/img/dashboard-mobile.webp"
                  width={780}
                  height={1520}
                  loading="lazy"
                  alt="The same dashboard on a phone: position summary and deposit, borrow and repay forms."
                />
              </figure>
            </div>
          </Reveal>
        </div>

        <div className="lp-cta-row" style={{ marginTop: 34, marginBottom: 0 }}>
          <Link href="/" className="btn-gradient">
            Open the dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Secondary: context                                                  */
/* ------------------------------------------------------------------ */

export function ContextSection() {
  return (
    <section className="lp-section section-minor band-inset" id="context">
      <div className="lp-container">
        <div className="context-grid">
          <Reveal>
            <div className="context-item">
              <b>Built on Solana</b>
              <p>
                Tokenized stocks already trade here, and their Token-2022 split multiplier is read on-chain.
                Continuous pricing means writing state all weekend, which only works with low fees.
              </p>
            </div>
          </Reveal>
          <Reveal delay={60}>
            <div className="context-item">
              <b>An oracle, not just a lending market</b>
              <p>
                The regime-aware oracle is its own on-chain program. A lender reads two prices and a regime flag
                from it; the lending market here is one consumer of it.
              </p>
            </div>
          </Reveal>
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
    q: "Why do the two prices keep changing?",
    a: (
      <>
        There is no keeper running, so the prices only update when something asks them to &mdash; the dashboard
        refreshes the oracle just before a borrow. Each update moves both prices a bounded fraction of the way
        toward their targets, so they drift and then settle. For the same reason the on-chain market-hours flag
        is set by hand and can differ from Pyth&apos;s live reading, which is shown next to it.
      </>
    ),
  },
  {
    q: "Does Vigil use real Pyth prices?",
    a: (
      <>
        Not yet. The oracle program has the Pyth ingestion and its checks, but on devnet it reads a mock Pyth
        program, because Pyth&apos;s price endpoints need an API key. Real Pyth data supplies the market-hours
        reading shown on the dashboard, not the prices.
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

        <div className="fineprint">
          <b>Deployment status</b>
          <ul>
            <li>Devnet only. Test tokens, no real value.</li>
            <li>Not audited.</li>
            <li>The oracle is fed by a mock Pyth program with stored prices; Pyth supplies market hours, not prices.</li>
          </ul>
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
              <Link href="/" className="btn-gradient">
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
