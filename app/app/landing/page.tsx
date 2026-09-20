import Link from "next/link";
import { GlowField } from "@/components/GlowField";
import { LiveProvider } from "@/components/LiveProvider";
import { HeroDivergence } from "@/components/HeroDivergence";
import { HeroLiveStrip } from "@/components/HeroLiveStrip";
import {
  AppShowcase,
  ContextSection,
  CtaPair,
  DeploymentStatus,
  DetailsSection,
  MechanismSection,
  ProofBand,
} from "@/components/LandingSections";

export default function LandingPage() {
  return (
    <div className="landing">
      <nav className="lp-nav">
        <div className="lp-wordmark">Vigil</div>
        <div className="lp-nav-links">
          <a href="#pricing">How pricing works</a>
          <Link href="/replay">Weekend Replay</Link>
          <a href="https://github.com/blaxko/vigil" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <Link href="/" className="btn-gradient">
          Launch App
        </Link>
      </nav>

      {/* One shared devnet poll + one Hermes poll feed every live element below. */}
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
                A lending market for tokenized stocks, priced by an oracle that knows when the market is shut.
              </p>
              <div className="lp-cta-row">
                <Link href="/" className="btn-gradient">
                  Launch App
                </Link>
                <Link href="/replay" className="btn-outline">
                  View Weekend Replay
                </Link>
              </div>

              <HeroDivergence />
              <HeroLiveStrip />
            </div>
          </div>
        </section>

        <DeploymentStatus />
        <MechanismSection />
        <ProofBand />
        <AppShowcase />
      </LiveProvider>

      <ContextSection />
      <DetailsSection />
      <CtaPair />

      <footer className="lp-footer">
        <div
          className="lp-container"
          style={{ display: "flex", justifyContent: "space-between", width: "100%", flexWrap: "wrap", gap: 12 }}
        >
          <span>Vigil &middot; Devnet deployment &middot; Test tokens, no real value</span>
          <a href="https://github.com/blaxko/vigil" target="_blank" rel="noreferrer">
            GitHub &rarr;
          </a>
        </div>
      </footer>
    </div>
  );
}
