import Link from "next/link";
import { GlowField } from "@/components/GlowField";
import { Marquee } from "@/components/Marquee";
import { Reveal } from "@/components/Reveal";
import { LiveProvider } from "@/components/LiveProvider";
import { HeroDevices } from "@/components/HeroDevices";
import { CtaPair, FaqSection, PricingCards, ProductShowcase, StatsGrid } from "@/components/LandingSections";

export default function LandingPage() {
  return (
    <div className="landing">
      <nav className="lp-nav">
        <div className="lp-wordmark">Vigil</div>
        <div className="lp-nav-links">
          <a href="#pricing">How pricing works</a>
          <a href="#faq">FAQ</a>
          <Link href="/replay">Weekend Replay</Link>
          <a href="https://github.com/blaxko/vigil" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <Link href="/" className="btn-gradient">
          Launch App
        </Link>
      </nav>

      {/* One shared devnet poll + one Hermes poll feed every live card below. */}
      <LiveProvider>
        <section className="lp-hero">
          <div className="glow-field-wrap" style={{ position: "relative" }}>
            <GlowField />
            <div className="lp-container" style={{ position: "relative", zIndex: 1 }}>
              <h1 className="lp-headline">
                Borrow Against Your Stocks
                <span className="gradient-text">Even When the Market&apos;s Closed.</span>
              </h1>
              <p className="lp-subhead">
                Common ways to handle a closed market are fixed conservative LTVs, hard staleness pauses, or
                deviation checks that oracle providers such as Chainlink advise integrators to configure.
                Vigil uses a continuous, dual-speed anchor-decay-clamp pricing model instead &mdash; a
                regime-aware oracle that knows the difference between a live market and a closed one, built as
                a module other lenders could adopt.
              </p>
              <p className="lp-who">
                <strong>Built for</strong> anyone holding tokenized stock (like AAPLx) who needs USDC on a
                Saturday &mdash; without selling the position or trusting a frozen Friday price.
              </p>
              <div className="lp-cta-row">
                <Link href="/" className="btn-gradient">
                  Launch App
                </Link>
                <Link href="/replay" className="btn-outline">
                  View Weekend Replay
                </Link>
              </div>
              <HeroDevices />
            </div>
          </div>
        </section>

        <Reveal>
          <Marquee />
        </Reveal>

        <ProductShowcase />
        <PricingCards />
        <StatsGrid />
      </LiveProvider>

      <section className="lp-section" id="why-solana">
        <div className="lp-container">
          <Reveal>
            <div className="lp-section-head">
              <h2 className="lp-section-title">Why Solana</h2>
              <p style={{ color: "var(--muted)", fontSize: 15 }}>
                Three reasons this is built here, not just deployed here.
              </p>
            </div>
          </Reveal>

          <div className="why-grid">
            <Reveal>
              <div className="bento-card">
                <div className="bento-title">Where tokenized stocks live</div>
                <div className="bento-body">
                  The real AAPLx token and its liquid AAPLx/USDC market already trade on Solana &mdash; the
                  collateral, the debt asset and the price signal are all native.
                </div>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="bento-card">
                <div className="bento-title">Token-2022 scaled-UI-amount</div>
                <div className="bento-body">
                  Tokenized stocks adjust for splits and dividends through a Token-2022 multiplier. Vigil
                  reads it on-chain, so collateral is valued correctly without an off-chain fix-up.
                </div>
              </div>
            </Reveal>
            <Reveal delay={160}>
              <div className="bento-card">
                <div className="bento-title">Cheap, frequent price ticks</div>
                <div className="bento-body">
                  Continuous pricing means updating on-chain state all weekend &mdash; the replay posts 149
                  real ticks (298 transactions) across one closure, which only works with Solana&apos;s
                  low fees.
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="lp-section" id="where-it-fits">
        <div className="lp-container">
          <Reveal>
            <div className="lp-section-head">
              <h2 className="lp-section-title">Where Vigil fits</h2>
              <p style={{ color: "var(--muted)", fontSize: 15 }}>
                A pricing layer for tokenized-stock lending, not only another lending market.
              </p>
            </div>
          </Reveal>

          <div className="why-grid">
            <Reveal>
              <div className="bento-card">
                <div className="bento-title">A module other lenders could adopt</div>
                <div className="bento-body">
                  Vigil ships with a lending market so the oracle can be seen working end to end, but the
                  regime-aware oracle is its own on-chain program. A lender reads two prices and a regime
                  flag from it; the lending logic here is one consumer, not a dependency.
                </div>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="bento-card">
                <div className="bento-title">What the guidance already says</div>
                <div className="bento-body">
                  Chainlink&apos;s{" "}
                  <a href="https://docs.chain.link/data-feeds/tokenized-equity-feeds" target="_blank" rel="noreferrer" className="inline-link">
                    tokenized-equity documentation
                  </a>{" "}
                  tells integrators to treat weekends and holidays as an expected state and to set deviation
                  limits, leaving the thresholds to each protocol. It prescribes no number. Vigil is one
                  concrete answer to the closed-market half of that.
                </div>
              </div>
            </Reveal>
            <Reveal delay={160}>
              <div className="bento-card">
                <div className="bento-title">Same hackathon, complementary scope</div>
                <div className="bento-body">
                  Sable (
                  <a href="https://github.com/Mgabal/Stock-Lend" target="_blank" rel="noreferrer" className="inline-link">
                    Mgabal/Stock-Lend
                  </a>
                  ) discloses in its README that its lending market uses a seeded reference rate, not a live
                  oracle feed, and scopes real pricing out as future work. Pricing under a closed market is
                  the layer Vigil focuses on.
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="lp-section" id="how-it-works">
        <div className="lp-container">
          <Reveal>
            <div className="lp-section-head">
              <h2 className="lp-section-title">How it works</h2>
            </div>
          </Reveal>

          <div className="steps">
            <Reveal delay={0}>
              <div className="step-card">
                <div className="step-num">STEP 01</div>
                <div className="bento-title" style={{ fontSize: 16 }}>
                  Deposit
                </div>
                <div className="bento-body">
                  Deposit tokenized stock (like AAPLx) into an isolated market &mdash; no need to sell it.
                </div>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div className="step-card">
                <div className="step-num">STEP 02</div>
                <div className="bento-title" style={{ fontSize: 16 }}>
                  Borrow
                </div>
                <div className="bento-body">
                  Borrow USDC up to the live Borrow-Limit Price &mdash; even on a Saturday.
                </div>
              </div>
            </Reveal>
            <Reveal delay={160}>
              <div className="step-card">
                <div className="step-num">STEP 03</div>
                <div className="bento-title" style={{ fontSize: 16 }}>
                  Adapt
                </div>
                <div className="bento-body">
                  Through a market closure, pricing adapts &mdash; Borrow-Limit tightens, Liquidation
                  widens &mdash; instead of freezing.
                </div>
              </div>
            </Reveal>
            <Reveal delay={240}>
              <div className="step-card">
                <div className="step-num">STEP 04</div>
                <div className="bento-title" style={{ fontSize: 16 }}>
                  Reopen
                </div>
                <div className="bento-body">On reopen, price converges back to the real market print &mdash; no jump.</div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <FaqSection />
      <CtaPair />

      <footer className="lp-footer">
        <div className="lp-container" style={{ display: "flex", justifyContent: "space-between", width: "100%", flexWrap: "wrap", gap: 12 }}>
          <span>
            Devnet only &mdash; no real funds involved. Built for the Stocklana hackathon.
          </span>
          <a href="https://github.com/blaxko/vigil" target="_blank" rel="noreferrer">
            GitHub &rarr;
          </a>
        </div>
      </footer>
    </div>
  );
}
