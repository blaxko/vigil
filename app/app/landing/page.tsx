import Link from "next/link";
import { GlowField } from "@/components/GlowField";
import { Marquee } from "@/components/Marquee";
import { Reveal } from "@/components/Reveal";
import { LiveHeroPreview } from "@/components/LiveHeroPreview";

export default function LandingPage() {
  return (
    <div className="landing">
      <nav className="lp-nav">
        <div className="lp-wordmark">Vigil</div>
        <div className="lp-nav-links">
          <a href="#how-it-works">How It Works</a>
          <Link href="/replay">Weekend Replay</Link>
          <a href="https://github.com/blaxko/vigil" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <Link href="/" className="btn-gradient">
          Launch App
        </Link>
      </nav>

      <section className="lp-hero">
        <div className="glow-field-wrap" style={{ position: "relative" }}>
          <GlowField />
          <div className="lp-container" style={{ position: "relative", zIndex: 1 }}>
            <h1 className="lp-headline">
              Borrow Against Your Stocks
              <span className="gradient-text">Even When the Market&apos;s Closed.</span>
            </h1>
            <p className="lp-subhead">
              Every tokenized-equity lending venue today freezes the price at Friday&apos;s close or
              falls back to a thin, easily-moved DEX price. Vigil runs a continuous, dual-speed
              anchor-decay-clamp pricing model instead &mdash; an oracle that knows the difference
              between a live market and a closed one.
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
            <Reveal>
              <LiveHeroPreview />
            </Reveal>
          </div>
        </div>
      </section>

      <Reveal>
        <Marquee />
      </Reveal>

      <section className="lp-section" id="features">
        <div className="lp-container">
          <Reveal>
            <div className="lp-section-head">
              <h2 className="lp-section-title">Priced for reality, not just uptime</h2>
              <p style={{ color: "var(--muted)", fontSize: 15 }}>
                Every card below is a mechanism already built, tested, and verified on devnet &mdash;
                not a roadmap item.
              </p>
            </div>
          </Reveal>

          <div className="bento-grid">
            <Reveal className="bento-large">
              <div className="bento-card">
                <div className="bento-icon">&#9679;</div>
                <div className="bento-title">Regime-Aware Oracle</div>
                <div className="bento-body">
                  A dual-price design: a slow-smoothed, conservative <strong style={{ color: "var(--green)" }}>Borrow-Limit Price</strong>{" "}
                  and a fast-smoothed, wider-banded <strong style={{ color: "var(--blue)" }}>Liquidation Price</strong>. Over-borrow
                  risk and unjust-liquidation risk are opposite failure modes &mdash; they never share
                  one number or one smoothing speed. Through a closure, one tightens while the other
                  widens, instead of both freezing together.
                </div>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <div className="bento-card">
                <div className="bento-icon">&#8776;</div>
                <div className="bento-title">Anchor-Decay-Clamp Pricing</div>
                <div className="bento-body">
                  No frozen price, no discontinuous reopen jump. Price decays smoothly from the last
                  live print toward a liquidity-dampened DEX reference through a closure, clamped
                  per-tick so no single update can move it too far at once.
                </div>
              </div>
            </Reveal>

            <Reveal delay={160}>
              <div className="bento-card">
                <div className="bento-icon">&#8635;</div>
                <div className="bento-title">Real Historical Replay</div>
                <div className="bento-body">
                  The actual Sept 11&ndash;14 2026 weekend, replayed through the live devnet programs:
                  149 on-chain ticks, 298 finalized transaction signatures. Not a simulation &mdash; a
                  real, verifiable sequence.
                </div>
                <div className="bento-stat">
                  <div>
                    <div className="n">149</div>
                    <div className="l">Ticks</div>
                  </div>
                  <div>
                    <div className="n">298</div>
                    <div className="l">Signatures</div>
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal delay={240} className="bento-wide">
              <div className="bento-card">
                <div className="bento-icon">&#128274;</div>
                <div className="bento-title">Full Transparency, By Design</div>
                <div className="bento-body">
                  Every demo screen says what is real and what is demo-controlled (today: the
                  open/closed market-hours flag, and a Borrow-time oracle refresh that re-posts a stored replay reference price, not a live one). Every price update and every transaction is
                  independently verifiable on-chain &mdash; no hidden simulation, ever.
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

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
