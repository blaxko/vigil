import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { LiveNumber } from "@/components/LiveNumber";
import { ReplaySparkChart } from "@/components/ReplaySparkChart";
import comparison from "@/public/comparison-output.json";
import stress from "@/public/stress-output.json";

const band = comparison.bandModel.sensitivity.find((s) => s.bandPct === comparison.bandModel.drawnBandPct)!;

/* ------------------------------------------------------------------ */
/* Demo-mode disclosure, directly under the hero                       */
/* ------------------------------------------------------------------ */

export function DemoModeBand() {
  return (
    <div className="lp-container demo-band-wrap">
      <div className="panel disclosure demo-band">
        <span className="disclosure-tag">Disclosed design choice</span>
        <h2 className="disclosure-title">Demo mode: market hours set by hand, price refresh uses stored replay data</h2>
        <p className="disclosure-lead">
          The on-chain open/closed flag is set manually (Pyth&apos;s real market hours are shown beside it), and
          Borrow triggers an oracle refresh that re-posts a stored replay reference price, not a live one. Every
          deposit, borrow and repay is still a real, unscripted transaction on the deployed devnet program.
        </p>
        <details>
          <summary>Details</summary>
          <p>
            Vigil&apos;s oracle takes market hours as an input. Feeding it automatically needs a
            continuously-running off-chain keeper watching real NYSE hours, which is separate infrastructure from
            the on-chain programs built here. So the regime flag reflects on-chain state, not a live market-hours
            check performed at this instant. Only that open/closed input is demo-controlled &mdash; the pricing
            math, the position accounting and every transaction are the real deployed programs. Likewise, with no
            keeper running, pressing Borrow first triggers a demo oracle refresh that re-posts the DEX reference
            price already stored on-chain from the Sept 11&ndash;14 replay: a stored price, not a live one.
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
              Through a closure the price decays from the last live print toward a liquidity-weighted DEX reference,
              clamped per update so no single update can move it too far. Over-borrowing and unjust liquidation are
              opposite failure modes, so they never share one number.
            </p>
          </div>
        </Reveal>

        <div className="tag-grid two">
          <Reveal>
            <article className="tag-card">
              <span className="tag tag-green">Borrow-Limit Price</span>
              <h3 className="tag-card-title">Tightens through closures</h3>
              <p className="tag-card-body">
                The conservative price that sizes how much you can borrow. It is slow-moving (5% of the gap per
                update) and, as a closure goes on, it tightens by up to 8% over the first hour, so it never chases a
                thin weekend market upward.
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
                The forgiving price used only to decide liquidation. It moves fast (15% of the gap per update) and,
                as a closure goes on, it widens by up to 12%, so a brief weekend dip cannot liquidate you unfairly.
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

const PROOF_FIGURES = [
  { value: "149", label: "real on-chain replay ticks" },
  { value: "298 / 298", label: "signatures finalized" },
  { value: "27", label: "Rust unit tests passing" },
  { value: "6", label: "real bugs found and fixed, logged" },
];

export function ProofBand() {
  return (
    <section className="proof-band section-major" id="proof">
      <div className="proof-glow" aria-hidden="true" />
      <div className="lp-container" style={{ position: "relative", zIndex: 1 }}>
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">Verified, not claimed</span>
            <h2 className="lp-section-title">One real weekend, replayed on-chain</h2>
            <p className="lp-section-lead">
              The actual Friday-close-to-Monday-open window of Sept 11&ndash;14, 2026, driven by real AAPLx/USDC
              trading data and run through the deployed devnet programs &mdash; next to three other approaches
              computed from that same data.
            </p>
          </div>
        </Reveal>

        <Reveal>
          <div className="proof-stage">
            <div className="proof-chart">
              <ReplaySparkChart />
            </div>
            <div className="proof-side">
              <div className="proof-figures">
                {PROOF_FIGURES.map((f) => (
                  <div key={f.label}>
                    <b>{f.value}</b>
                    <span>{f.label}</span>
                  </div>
                ))}
              </div>
              <p className="proof-note">
                A frozen-price venue would have sat flat all weekend, then jumped{" "}
                {comparison.frozenVaultDiscontinuousJumpPct.toFixed(2)}% the instant it reopened. A &plusmn;
                {band.bandPct}% deviation-band oracle would have held a stale price on {band.trippedTicks} of{" "}
                {band.totalTicks} ticks.
              </p>
              <Link href="/replay" className="btn-outline">
                See the full replay
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. The app, with the user sequence                                  */
/* ------------------------------------------------------------------ */

const JOURNEY = [
  { n: "01", t: "Deposit", d: "You hold tokenized AAPLx and don't want to sell it. Deposit it as collateral." },
  {
    n: "02",
    t: "Borrow",
    d: "Borrow USDC against it, up to the Borrow-Limit Price — including Saturday, when the stock market is shut.",
  },
  {
    n: "03",
    t: "Hold through the closure",
    d: "The Borrow-Limit tightens and the Liquidation Price widens on their own. Nothing for you to do.",
  },
  { n: "04", t: "Repay and withdraw", d: "Repay any amount up to your debt and take your AAPLx back." },
];

export function AppShowcase() {
  return (
    <section className="lp-section section-major" id="product">
      <div className="lp-container">
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">The real product</span>
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
                  alt="The Vigil dashboard with a connected wallet: live Market panel, a position of 8 AAPLx deposited with 3 USDC borrowed, and deposit, borrow and repay forms."
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

        <p className="app-caption">
          On devnet with test tokens: the AAPLx here is a test mint from the faucet, the USDC is a mock token, and
          Borrow first refreshes the oracle from a stored replay price. A cropped, unedited capture of a real devnet
          session on 2026-09-20 &mdash; the prices in it may have moved since.
        </p>

        <div className="lp-cta-row" style={{ marginTop: 26, marginBottom: 0 }}>
          <Link href="/" className="btn-gradient">
            Open the live dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Secondary: context (Why Solana + Where Vigil fits, merged)          */
/* ------------------------------------------------------------------ */

export function ContextSection() {
  return (
    <section className="lp-section section-minor band-inset" id="context">
      <div className="lp-container">
        <Reveal>
          <div className="lp-section-head minor-head">
            <h2 className="lp-section-title">Why this, here</h2>
          </div>
        </Reveal>

        <div className="context-grid">
          <Reveal>
            <div className="context-item">
              <b>Built on Solana, not just deployed there</b>
              <p>
                The real AAPLx token and its liquid AAPLx/USDC market already trade here. Tokenized stocks adjust for
                splits through a Token-2022 multiplier, which Vigil reads on-chain rather than patching off-chain.
                And continuous pricing means writing state all weekend &mdash; the replay posts 149 ticks across one
                closure, which only works with low fees.
              </p>
            </div>
          </Reveal>
          <Reveal delay={60}>
            <div className="context-item">
              <b>An oracle module, not just a lending market</b>
              <p>
                Vigil ships with a lending market so the oracle can be seen working end to end, but the regime-aware
                oracle is its own on-chain program. A lender reads two prices and a regime flag from it; the lending
                logic here is one consumer, not a dependency.
              </p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="context-item">
              <b>What the guidance already says</b>
              <p>
                Chainlink&apos;s{" "}
                <a
                  href="https://docs.chain.link/data-feeds/tokenized-equity-feeds"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-link"
                >
                  tokenized-equity documentation
                </a>{" "}
                tells integrators to treat weekends and holidays as an expected state and to set deviation limits,
                leaving the thresholds to each protocol. It prescribes no number. Common answers are fixed
                conservative LTVs, hard staleness pauses, or a deviation band. Vigil is one concrete answer to the
                closed-market half of that.
              </p>
            </div>
          </Reveal>
          <Reveal delay={180}>
            <div className="context-item">
              <b>Same hackathon, complementary scope</b>
              <p>
                Sable (
                <a href="https://github.com/Mgabal/Stock-Lend" target="_blank" rel="noreferrer" className="inline-link">
                  Mgabal/Stock-Lend
                </a>
                ) discloses in its README that its lending market uses a seeded reference rate, not a live oracle
                feed, and scopes real pricing out as future work. Pricing under a closed market is the layer Vigil
                focuses on.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Secondary: FAQ + the remaining verified figures + what this is not  */
/* ------------------------------------------------------------------ */

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is Vigil, actually?",
    a: (
      <>
        A lending market for tokenized stocks on Solana with a different kind of oracle. You deposit a tokenized
        stock (AAPLx here) as collateral and borrow USDC against it. Because stocks stop trading on nights and
        weekends, Vigil prices your collateral with two numbers that move in opposite directions while the market is
        closed: a conservative Borrow-Limit Price and a forgiving Liquidation Price. It is a hackathon build for
        Stocklana, running on devnet.
      </>
    ),
  },
  {
    q: "Is real money involved?",
    a: (
      <>
        No. Everything runs on Solana devnet. The AAPLx on the dashboard is a test token this project mints from a
        faucet, the USDC is a mock token, and the SOL is devnet SOL with no value. The real mainnet AAPLx is used
        only as a source of historical prices for the replay. Nothing you do here can gain or lose real funds.
      </>
    ),
  },
  {
    q: "Why do the Borrow-Limit and Liquidation numbers keep changing?",
    a: (
      <>
        Because no keeper is running. The prices only update when something asks them to: the dashboard refreshes the
        oracle right before a Borrow, or a script does. Each update moves the two prices a fraction of the way toward
        fixed targets derived from a stored reference price, and the movement is bounded (the Borrow-Limit tightens
        by up to 8%, the Liquidation Price widens by up to 12%). So they drift slowly and then settle. They are not a
        live market feed, and other visitors&apos; activity nudges them too.
      </>
    ),
  },
  {
    q: "What does “Branch B” or “demo mode” mean, in plain language?",
    a: (
      <>
        The original design had two modes. In Branch A a live keeper tells the oracle whether the stock market is
        open. In Branch B, which is what this build runs, a person sets that open-or-closed flag by hand. Only that
        one input is manual: the pricing math, the positions and every transaction are the real deployed programs. On
        the site it is called demo mode, and the same disclosure is on the dashboard and the replay page.
      </>
    ),
  },
  {
    q: "Why does the on-chain regime sometimes differ from the Pyth market-hours row?",
    a: (
      <>
        They come from different places. The Pyth row is real, live market-hours data for AAPL. The on-chain regime
        is the flag that was set by hand, so it can lag or stay closed while the real market is open, for example
        during US trading hours. When they disagree, the page says so instead of hiding it. A keeper would keep them
        in sync; this build does not have one. The Pyth row is schedule data, not a price.
      </>
    ),
  },
  {
    q: "Does Vigil use real Pyth prices?",
    a: (
      <>
        Not yet. The oracle program has the Pyth ingestion and its checks (feed id, staleness, owner), but on devnet
        it reads a test-only mock Pyth program, because Pyth&apos;s price and Benchmarks endpoints returned 401
        without an API key. The replay&apos;s Friday-close and Monday-reopen anchors come from the real AAPLx/USDC
        pool instead. The market-hours row is the one place real Pyth data is used today.
      </>
    ),
  },
  {
    q: "What can go wrong?",
    a: (
      <>
        The stress test on the{" "}
        <Link href="/replay" className="inline-link">
          replay page
        </Link>{" "}
        is hypothetical, but it shows one honest limit: at the deployed reserve&apos;s{" "}
        {stress.reserve.maxLtvBps / 100}% max LTV, a weekend gap of about{" "}
        {stress.inputs.insolvencyGapPct.toFixed(1)}% or more leaves a maximum-LTV position owing more than its
        collateral, whatever the Liquidation Price is. That is a reserve parameter, not something the oracle can fix.
      </>
    ),
  },
];

const MORE_FIGURES = [
  {
    value: "7 / 7",
    label: "lifecycle transactions finalized",
    note: "Deposit, borrow, liquidate, repay and withdraw, with two borrowers.",
  },
  {
    value: "3",
    label: "programs deployed on devnet",
    note: "regime_oracle, lending_market and the test-only mock_pyth, confirmed executable.",
  },
  {
    value: `${band.trippedTicks} of ${band.totalTicks}`,
    label: `ticks the ±${band.bandPct}% band oracle held the price`,
    note: "At ±2% it never trips this weekend. The width is chosen from Chainlink's documented 1–2% typical jumps, not recommended by it.",
  },
  {
    value: `${stress.inputs.insolvencyGapPct.toFixed(1)}%`,
    label: "gap where max-LTV positions first owe more than their collateral",
    note: `Hypothetical stress test at the deployed ${stress.reserve.maxLtvBps / 100}% LTV: set by that parameter, not by the oracle.`,
  },
];

export function DetailsSection() {
  return (
    <section className="lp-section section-minor" id="faq">
      <div className="lp-container">
        <Reveal>
          <div className="lp-section-head minor-head">
            <h2 className="lp-section-title">Questions people actually asked</h2>
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
          <details className="fineprint-figures">
            <summary>The rest of the verified figures</summary>
            <ul>
              {MORE_FIGURES.map((f) => (
                <li key={f.label}>
                  <b>{f.value}</b> {f.label}
                  <span> &mdash; {f.note}</span>
                </li>
              ))}
            </ul>
          </details>

          <p className="stat-caveat">
            <strong>What this is not:</strong> no real funds, no audit, no production uptime, and the devnet oracle is
            fed by a test-only mock Pyth program with stored prices. The market-hours row on the dashboard is real
            Pyth data; the prices are not.
          </p>
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
            <p>Switch your wallet to devnet, get some test AAPLx, and borrow against it. No real funds involved.</p>
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
