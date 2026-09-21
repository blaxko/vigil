import { Reveal } from "@/components/Reveal";

/* ------------------------------------------------------------------ */
/* How Vigil uses Pyth                                                 */
/*                                                                     */
/* Every claim here is read off programs/regime_oracle:                */
/*   update_price.rs  - owner / feed id / 60 s age / positive checks,  */
/*   pyth_types.rs    - fully-verified check (VerificationLevel::Full) */
/*                      price -/+ confidence, closed-market branch     */
/*   math.rs          - conservative_lower / protective_upper,         */
/*                      DEX weight cap (60%), ramps, EMA and clamp     */
/*   pyth_types.rs    - PriceUpdateV2 layout mirror + unit tests       */
/* ------------------------------------------------------------------ */

const PYTH_CARDS: { tag: string; tone: string; title: string; body: React.ReactNode }[] = [
  {
    tag: "Market open",
    tone: "tag-green",
    title: "Prices with the confidence interval",
    body: (
      <>
        While the market is open, the oracle reads Pyth&apos;s price and its confidence. The Borrow-Limit Price is price
        minus confidence and the Liquidation Price is price plus confidence, so both widen when Pyth is less sure.
      </>
    ),
  },
  {
    tag: "Every read",
    tone: "tag-blue",
    title: "Checked on-chain before it counts",
    body: (
      <>
        The program rejects a Pyth update that is older than 60 seconds, carries the wrong feed ID, is not owned by the
        configured Pyth receiver program, is not fully verified, or has a non-positive price or confidence. The
        staleness, feed-ID, verification and future-timestamp checks have unit tests.
      </>
    ),
  },
  {
    tag: "Market closed",
    tone: "tag-violet",
    title: "A frozen print isn't a price",
    body: (
      <>
        While the market is shut, the oracle ignores Pyth&apos;s weekend print. It starts from the last open-market price
        it took from Pyth, blends in a liquidity-weighted DEX reference capped at 60%, and moves the two prices apart
        gradually.
      </>
    ),
  },
  {
    tag: "Market hours",
    tone: "tag-green",
    title: "Pyth's schedule, live on the site",
    body: (
      <>
        Pyth publishes each equity feed&apos;s market schedule. Vigil reads AAPL&apos;s live schedule from Hermes and shows it
        next to its own pricing mode, on the landing page and the dashboard.
      </>
    ),
  },
];

export function PythSection() {
  return (
    <section className="lp-section section-major" id="pyth">
      <div className="lp-container">
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">Built on Pyth</span>
            <h2 className="lp-section-title">Pyth sets the price while the market is open</h2>
            <p className="lp-section-lead">
              Vigil&apos;s oracle is built around Pyth&apos;s price, confidence and schedule, and it decides what to do when
              Pyth&apos;s feed goes quiet.
            </p>
          </div>
        </Reveal>

        <div className="tag-grid two info-grid">
          {PYTH_CARDS.map((c, i) => (
            <Reveal key={c.title} delay={i * 60}>
              <article className="tag-card">
                <span className={`tag ${c.tone}`}>{c.tag}</span>
                <h3 className="tag-card-title">{c.title}</h3>
                <p className="tag-card-body">{c.body}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <div className="pyth-status">
            <div>
              <b>Where it stands</b>
              <p>
                In this deployment the market is set to closed, so no Pyth price account is read. A mock Pyth program, which
                writes the same <code>PriceUpdateV2</code> layout, fed the replay&apos;s warm-up and reopen ticks, because
                Pyth&apos;s price endpoints need an API key and its AAPL account on devnet was last updated on July 2. The
                open-market path has read a live Pyth account once, for SOL/USD on devnet (
                <a
                  href="https://explorer.solana.com/tx/5TiH4tmBGozaPA6hKZc6UHvgeKtuxxaRh7CZh385jVmxo8UbKTpd2Y5xwt2LLDynqQWvJbJwJ7K11YdQLT9ycmgA?cluster=devnet"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-link"
                >
                  5TiH4t&hellip;ycmgA
                </a>
                ). That checks the ingestion code, not an AAPL market.
              </p>
            </div>
            <div>
              <b>Keeper today</b>
              <p>
                The refresh route in this repo already does a keeper&apos;s closed-market job: before a borrow it cranks{" "}
                <code>update_price</code> with a funded key, only when the oracle is over 60 seconds old. One real refresh:{" "}
                <a
                  href="https://explorer.solana.com/tx/2eQW3oVeX7xzptsS9DphMtxJo4XSFUnrxvJ5iwfzFKVTNrghmepkvh6btkXrcqj957816RNcea1R5FqtVfHWytyP?cluster=devnet"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-link"
                >
                  2eQW3o&hellip;WytyP
                </a>
                . It re-posts the stored reference price, so it is not a live feed.
              </p>
            </div>
            <div>
              <b>Before mainnet</b>
              <p>
                Point the oracle at Pyth&apos;s receiver program, run a keeper that posts Pyth prices and follows the
                exchange schedule, and complete an audit.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Why Solana                                                          */
/*                                                                     */
/*   token2022.rs      - reads the ScaledUiAmount multiplier on-chain  */
/*   update_price.rs   - permissionless cranker                        */
/*   regime_oracle     - its own program, RegimeState PDA read by the  */
/*                       lending market                                */
/*   replay            - 63 closure ticks / 126 txs on devnet          */
/* ------------------------------------------------------------------ */

const SOLANA_CARDS: { tag: string; title: string; body: React.ReactNode }[] = [
  {
    tag: "The asset",
    title: "Tokenized stocks already live here",
    body: (
      <>
        AAPLx is a Token-2022 mint with the scaled-UI-amount extension, which adjusts holdings for events such as stock
        splits. Vigil reads that multiplier on-chain before it values any collateral.
      </>
    ),
  },
  {
    tag: "The cadence",
    title: "Continuous pricing needs cheap writes",
    body: (
      <>
        Pricing through a closure means writing fresh oracle state again and again across two days. The Sept 11&ndash;14 closure
        took 63 oracle ticks, 126 transactions. What they cost is below.
      </>
    ),
  },
  {
    tag: "The crank",
    title: "Anyone can update the prices",
    body: (
      <>
        <code>update_price</code> is permissionless. Any account can trigger a recompute from inputs the program has already
        authenticated, so a price update doesn&apos;t wait on one operator.
      </>
    ),
  },
  {
    tag: "The oracle",
    title: "One account, readable by any lender",
    body: (
      <>
        The regime oracle is its own program. One <code>RegimeState</code> account holds both prices and the regime flag,
        so another Solana lender can read it directly. Vigil&apos;s lending market is one consumer.
      </>
    ),
  },
];

export function SolanaSection() {
  return (
    <section className="lp-section section-major band-inset" id="solana">
      <div className="lp-container">
        <Reveal>
          <div className="lp-section-head">
            <span className="section-kicker">Why Solana</span>
            <h2 className="lp-section-title">Built where tokenized stocks trade</h2>
            <p className="lp-section-lead">
              A stock that lives on-chain can be collateral on-chain, and an oracle that updates all weekend needs a chain
              that makes that cheap.
            </p>
          </div>
        </Reveal>

        <div className="tag-grid two info-grid">
          {SOLANA_CARDS.map((c, i) => (
            <Reveal key={c.title} delay={i * 60}>
              <article className="tag-card">
                <span className="tag tag-blue">{c.tag}</span>
                <h3 className="tag-card-title">{c.title}</h3>
                <p className="tag-card-body">{c.body}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <div className="cost-strip">
            <div className="cost-head">What the closure&apos;s 126 writes cost</div>
            <div className="cost-figures">
              <div className="cost-fig">
                <span className="cost-label">On Solana</span>
                <b className="cost-num c-green">$0.11</b>
                <span className="cost-sub">0.000945 SOL in fees, summed from the closure&apos;s 126 transactions</span>
              </div>
              <div className="cost-fig">
                <span className="cost-label">On Ethereum mainnet, at minimum</span>
                <b className="cost-num">$0.74</b>
                <span className="cost-sub">
                  the same 126 writes at 26,000 gas each and 0.084 gwei on Sept 21, about 7&times; more
                </span>
              </div>
            </div>
            <p className="cost-note">
              Solana: the fee field of every transaction from the closing tick through the reopen, 5,000 lamports per
              signature (63 with one signature, 63 with two), priced at SOL $112.70. Ethereum: 21,000 gas for any transaction
              plus a 5,000-gas storage update, before any contract logic or calldata, so a floor, at ETH $2,702. The
              replay&apos;s 86 earlier warm-up ticks (172 transactions, 0.00086 SOL) walked the seeded price up to the Friday
              close and are not counted. Prices from CoinGecko and gas from a public Ethereum RPC, Sept 21, 2026. Mainnet
              gas moves with demand; Solana&apos;s base fee is fixed per signature.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

