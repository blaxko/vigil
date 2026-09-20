import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { LiveNumber } from "@/components/LiveNumber";
import comparison from "@/public/comparison-output.json";
import stress from "@/public/stress-output.json";

/* ------------------------------------------------------------------ */
/* Full-bleed product showcase                                         */
/* ------------------------------------------------------------------ */

export function ProductShowcase() {
  return (
    <section className="showcase" id="product">
      <div className="showcase-glow" aria-hidden="true" />
      <div className="lp-container" style={{ position: "relative", zIndex: 1 }}>
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">The real product</span>
            <h2 className="lp-section-title">The dashboard, in use</h2>
            <p style={{ color: "var(--muted)", fontSize: 15 }}>
              A real devnet session: test AAPLx deposited as collateral, test USDC borrowed against it, every
              transaction confirmed on-chain.
            </p>
          </div>
        </Reveal>

        <Reveal>
          <div className="showcase-stage">
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

        <p className="showcase-caption">
          A cropped, unedited capture of the running dashboard from a real devnet session on 2026-09-20 (a throwaway
          test wallet and test tokens). The prices in it have since moved slightly; the live numbers are in the hero.
        </p>

        <div className="showcase-steps">
          <div>
            <b>1 &middot; Deposit</b>
            <span>Test AAPLx goes in as collateral. The token is a devnet test mint, not real AAPLx.</span>
          </div>
          <div>
            <b>2 &middot; Borrow</b>
            <span>The app first refreshes the oracle from a stored replay price, then sends the borrow.</span>
          </div>
          <div>
            <b>3 &middot; Repay</b>
            <span>Repay any amount up to the debt. Inline checks stop a bad amount before your wallet is asked.</span>
          </div>
        </div>

        <div className="lp-cta-row" style={{ marginTop: 28, marginBottom: 0 }}>
          <Link href="/" className="btn-gradient">
            Open the live dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How pricing works: three tagged cards                               */
/* ------------------------------------------------------------------ */

export function PricingCards() {
  return (
    <section className="lp-section" id="pricing">
      <div className="lp-container">
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">How pricing works</span>
            <h2 className="lp-section-title">Two prices, moving in opposite directions</h2>
            <p style={{ color: "var(--muted)", fontSize: 15 }}>
              Through a closure the price decays from the last live print toward a liquidity-weighted DEX reference,
              clamped per update so no single update can move it too far. Over-borrowing and unjust liquidation are
              opposite failure modes, so they never share one number.
            </p>
          </div>
        </Reveal>

        <div className="tag-grid">
          <Reveal>
            <article className="tag-card">
              <span className="tag tag-green">Borrow-Limit Price</span>
              <h3 className="tag-card-title">Tightens through closures</h3>
              <p className="tag-card-body">
                The conservative price that sizes how much you can borrow. It is slow-moving (5% of the gap per update)
                and, as a closure goes on, it tightens by up to 8% over the first hour, so it never chases a thin weekend
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
                The forgiving price used only to decide liquidation. It moves fast (15% of the gap per update) and, as a
                closure goes on, it widens by up to 12%, so a brief weekend dip cannot liquidate you unfairly.
              </p>
              <div className="tag-card-live">
                <span>Live now</span>
                <LiveNumber kind="liquidation" className="c-blue" />
              </div>
            </article>
          </Reveal>
          <Reveal delay={160}>
            <article className="tag-card">
              <span className="tag tag-violet">Weekend Replay</span>
              <h3 className="tag-card-title">Real historical verification</h3>
              <p className="tag-card-body">
                The actual Sept 11&ndash;14, 2026 weekend replayed through the deployed programs, next to a frozen-price
                venue, a DEX-only venue and a &plusmn;1% deviation-band oracle computed from the same data.
              </p>
              <div className="tag-card-live">
                <span>149 ticks &middot; 298 signatures</span>
                <Link href="/replay" className="inline-link">
                  See the replay &rarr;
                </Link>
              </div>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Verified, not claimed: only figures re-checked or computed from repo */
/* ------------------------------------------------------------------ */

export function StatsGrid() {
  const band1 = comparison.bandModel.sensitivity.find((s) => s.bandPct === comparison.bandModel.drawnBandPct)!;
  const stats: { value: string; label: string; note: string }[] = [
    { value: "149", label: "real on-chain replay ticks", note: "Sept 11–14 weekend, run through the deployed devnet programs." },
    { value: "298 / 298", label: "replay signatures finalized", note: "Re-checked on 2026-09-20 with getSignatureStatuses, all of them." },
    { value: "7 / 7", label: "lifecycle transactions finalized", note: "Deposit, borrow, liquidate, repay and withdraw, with two borrowers." },
    { value: "27", label: "Rust unit tests passing", note: "17 in regime_oracle and 10 in lending_market, re-run on 2026-09-20." },
    { value: "3", label: "programs deployed on devnet", note: "regime_oracle, lending_market and the test-only mock_pyth, confirmed executable." },
    { value: "6", label: "real bugs found and fixed, logged", note: "The ones written up in the README's two bug logs (owner check, token-program split, resume safety and more). Others fixed later are in git history, not counted here." },
    {
      value: `${band1.trippedTicks} of ${band1.totalTicks}`,
      label: `ticks the ±${band1.bandPct}% band oracle held the price`,
      note: "At ±2% it never trips this weekend. The width is chosen from Chainlink's documented 1–2% typical jumps, not recommended by it.",
    },
    {
      value: `${stress.inputs.insolvencyGapPct.toFixed(1)}%`,
      label: "gap where max-LTV positions first owe more than their collateral",
      note: `Hypothetical stress test at the deployed ${stress.reserve.maxLtvBps / 100}% LTV: set by that parameter, not by the oracle.`,
    },
  ];

  return (
    <section className="lp-section" id="verified">
      <div className="lp-container">
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">Verified, not claimed</span>
            <h2 className="lp-section-title">What has actually been checked</h2>
            <p style={{ color: "var(--muted)", fontSize: 15 }}>
              A hackathon build on devnet. Every figure below was re-checked recently or is computed from data in this
              repository.
            </p>
          </div>
        </Reveal>

        <div className="stat-grid">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={(i % 4) * 60}>
              <div className="stat-tile">
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
                <div className="stat-note">{s.note}</div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <p className="stat-caveat">
            <strong>What this is not:</strong> no real funds, no audit, no production uptime, and the devnet oracle is fed
            by a test-only mock Pyth program with stored prices. The market-hours row on the dashboard is real Pyth data;
            the prices are not.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is Vigil, actually?",
    a: (
      <>
        A lending market for tokenized stocks on Solana with a different kind of oracle. You deposit a tokenized stock
        (AAPLx here) as collateral and borrow USDC against it. Because stocks stop trading on nights and weekends,
        Vigil prices your collateral with two numbers that move in opposite directions while the market is closed: a
        conservative Borrow-Limit Price and a forgiving Liquidation Price. It is a hackathon build for Stocklana,
        running on devnet.
      </>
    ),
  },
  {
    q: "Is real money involved?",
    a: (
      <>
        No. Everything runs on Solana devnet. The AAPLx on the dashboard is a test token this project mints from a
        faucet, the USDC is a mock token, and the SOL is devnet SOL with no value. The real mainnet AAPLx is used only
        as a source of historical prices for the replay. Nothing you do here can gain or lose real funds.
      </>
    ),
  },
  {
    q: "Why do the Borrow-Limit and Liquidation numbers keep changing?",
    a: (
      <>
        Because no keeper is running. The prices only update when something asks them to: the dashboard refreshes the
        oracle right before a Borrow, or a script does. Each update moves the two prices a fraction of the way toward
        fixed targets derived from a stored reference price, and the movement is bounded (the Borrow-Limit tightens by
        up to 8%, the Liquidation Price widens by up to 12%). So they drift slowly and then settle. They are not a
        live market feed, and other visitors&apos; activity nudges them too.
      </>
    ),
  },
  {
    q: "What does “Branch B” or “demo mode” mean, in plain language?",
    a: (
      <>
        The original design had two modes. In Branch A a live keeper tells the oracle whether the stock market is open.
        In Branch B, which is what this build runs, a person sets that open-or-closed flag by hand. Only that one
        input is manual: the pricing math, the positions and every transaction are the real deployed programs. On the
        site it is called demo mode, and the same disclosure is on the dashboard and the replay page.
      </>
    ),
  },
  {
    q: "Why does the on-chain regime sometimes differ from the Pyth market-hours row?",
    a: (
      <>
        They come from different places. The Pyth row is real, live market-hours data for AAPL. The on-chain regime is
        the flag that was set by hand, so it can lag or stay closed while the real market is open, for example during
        US trading hours. When they disagree, the page says so instead of hiding it. A keeper would keep them in sync;
        this build does not have one. The Pyth row is schedule data, not a price.
      </>
    ),
  },
  {
    q: "Does Vigil use real Pyth prices?",
    a: (
      <>
        Not yet. The oracle program has the Pyth ingestion and its checks (feed id, staleness, owner), but on devnet
        it reads a test-only mock Pyth program, because Pyth&apos;s price and Benchmarks endpoints returned 401
        without an API key. The replay&apos;s Friday-close and Monday-reopen anchors come from the real AAPLx/USDC pool
        instead. The market-hours row is the one place real Pyth data is used today.
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
        is hypothetical, but it shows one honest limit: at the deployed reserve&apos;s 90% max LTV, a weekend gap of about
        11% or more leaves a maximum-LTV position owing more than its collateral, whatever the Liquidation Price is.
        That is a reserve parameter, not something the oracle can fix.
      </>
    ),
  },
];

export function FaqSection() {
  return (
    <section className="lp-section" id="faq">
      <div className="lp-container faq-container">
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">FAQ</span>
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
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Closing CTA pair (replaces a newsletter signup)                     */
/* ------------------------------------------------------------------ */

export function CtaPair() {
  return (
    <section className="lp-section cta-section" id="try-it">
      <div className="lp-container">
        <Reveal>
          <div className="cta-card">
            <h2 className="lp-section-title" style={{ marginBottom: 8 }}>
              Try it on devnet
            </h2>
            <p style={{ color: "var(--muted)", fontSize: 15, margin: "0 0 22px" }}>
              Switch your wallet to devnet, get some test AAPLx, and borrow against it. No real funds involved.
            </p>
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
