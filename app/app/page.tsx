import Link from "next/link";
import { GlowField } from "@/components/GlowField";
import { LiveProvider } from "@/components/LiveProvider";
import { HeroDivergence } from "@/components/HeroDivergence";
import { HeroLiveStrip } from "@/components/HeroLiveStrip";
import { SiteNav } from "@/components/SiteNav";
import {
  AppShowcase,
  CtaPair,
  DeploymentStatus,
  DetailsSection,
  MechanismSection,
  ProofBand,
} from "@/components/LandingSections";
import { PythSection, SolanaSection } from "@/components/PythSolanaSections";

export default function LandingPage() {
  return (
    <div className="landing">
      <SiteNav />

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
                A lending market for tokenized stocks on Solana, priced by an oracle that knows when the market is shut.
              </p>
              <div className="lp-cta-row">
                <Link href="/app" className="btn-gradient">
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
        <PythSection />
        <SolanaSection />
        <AppShowcase />
      </LiveProvider>

      <DetailsSection />
      <CtaPair />

      <footer className="lp-footer">
        <div
          className="lp-container"
          style={{ display: "flex", justifyContent: "space-between", width: "100%", flexWrap: "wrap", gap: 12 }}
        >
          <span>Vigil &middot; Solana devnet &middot; Test tokens, no real value &middot; Not audited</span>
          <a href="https://github.com/blaxko/vigil" target="_blank" rel="noreferrer">
            GitHub &rarr;
          </a>
        </div>
      </footer>
    </div>
  );
}
