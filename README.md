# Vigil

Regime-aware lending protocol for tokenized US equities on Solana, built around a
regime-aware oracle (`regime_oracle`) that other lenders could adopt: it is a separate
on-chain program exposing two prices and a regime flag, and the lending market here is
one consumer of it. See
`Vigil Project Brief 2.md` for the full design rationale, architecture, and
acceptance criteria.

## Related work and guidance

- **Chainlink, tokenized-equity feeds** ([docs](https://docs.chain.link/data-feeds/tokenized-equity-feeds),
  [24/5 US equities guide](https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide)):
  tells integrators to treat weekends and holidays as an expected state (pause, allow bounded
  trading, or reference secondary markets) and to set deviation limits / circuit breakers. It
  prescribes **no numeric band** and leaves thresholds to each protocol's risk appetite. Its only
  figures are descriptive: session-transition jumps are "typically 1-2%", with spikes of "10-20%+".
- **Sable / Stock-Lend** (same hackathon, [Mgabal/Stock-Lend](https://github.com/Mgabal/Stock-Lend)):
  its README's "Disclosed scope limitation" says pricing in its lending market "uses a seeded
  reference rate, not a live oracle feed" and that a production version would need an oracle
  (e.g. Pyth). Real pricing is out of its scope; it is Vigil's focus.

## Status

**Phase 1 (core contracts): done. Phase 2 (liquidation + frontend
integration): done, verified on devnet with real signatures, frontend
smoke-tested. Phase 3 (replay harness + comparison UI): done — a real
historical weekend replayed through the live devnet programs, 298/298
signatures programmatically confirmed finalized, both pages
screenshot-verified rendering real content. Phase 4 (demo polish +
submission): disclosure labels done; demo recording and hackathon
submission are this repo's owner's action, not something done from this
environment — see "Submission checklist" at the bottom.**

- [x] Anchor workspace scaffold — three programs: `regime_oracle`,
      `lending_market`, `mock_pyth` (test/demo-only, see below)
- [x] `regime_oracle`: `RegimeState` account, anchor-decay-clamp fixed-point
      math with unit tests, staleness/feed-id/owner-checked Pyth reads,
      `initialize`/`set_regime`/`post_dex_reference`/`update_price`
- [x] `lending_market`: `Reserve`/`Position` accounts, Token-2022
      scaled-ui-amount conversion with unit tests, LTV/health-factor math
      with unit tests, `initialize_reserve`/`deposit`/`withdraw`/`borrow`/
      `repay`/`liquidate`
- [x] `cargo test --workspace` — **29/29 passing** (19 regime_oracle, 10
      lending_market)
- [x] `anchor build` — all three programs compile to real Solana BPF
      bytecode
- [x] Local-validator (Surfpool) integration tests — **7/7 passing**,
      exercising every instruction above as real on-chain calls, including
      a full price-crash-to-liquidation scenario
- [x] Devnet deployment — all three programs live (addresses below)
- [x] Devnet seed script (`npm run seed:devnet`) — creates the AAPLx-
      equivalent and mock-USDC mints, initializes the oracle + reserve
- [x] Devnet lifecycle demo — deposit, borrow, liquidate (by a second
      wallet), repay, withdraw all have real, finalized devnet signatures
      (see below)
- [x] Wallet-adapter-connected frontend (`app/`) — dashboard + deposit/
      borrow/repay forms, built against the devnet deployment; `next build`
      passes and a dev-server smoke test confirms the page actually renders
      real content (title, wallet button, live account reads)
- [x] Replay harness (`scripts/replay/`) — a real, completed weekend
      (Fri Sep 11 2026 20:00 UTC close &rarr; Mon Sep 14 2026 13:30 UTC open)
      replayed through the live devnet programs: 61 real hourly candles
      from GeckoTerminal's actual AAPLx/USDC pool, each posted as a real
      `post_dex_reference` + `update_price` transaction pair, plus the
      market-close and reopen-snap transitions: a 63-tick closure, preceded by
      an 86-tick open-market warm-up that walked the seeded $150 price to the
      Friday close through the mock Pyth account — **149 total ticks, every
      one with a real finalized devnet signature** (`scripts/replay/replay-output.json`)
- [x] Comparison (Vigil / frozen-price vault / DEX-only vault / fixed deviation-band oracle),
      computed from that single real dataset (`npm run replay:compare`,
      rendered at `/replay`) — never three independently tuned scenarios
- [x] All 298 unique replay signatures programmatically verified finalized
      via `getSignatureStatuses` (`npm run replay:verify`, not a spot check)
      — see `scripts/replay/signature-verification.json`
- [x] Frontend pages (`/`, `/app`, `/replay`) verified rendering real on-chain data
      in a headless browser at 1440px and 390px, not just that `next build` passes
- [x] On-screen disclosure: a Devnet status strip on `/` and `/app` (market hours set
      by hand, prices from a DEX reference stored on-chain from the replay and
      refreshed by Borrow, no Pyth price account read while the market is set to
      closed, mock USDC liquidity with no interest, not audited) and a
      data-source strip on `/replay` (GeckoTerminal anchors, Pyth Benchmarks
      requires a key)
- [x] Live Pyth market-hours row on `/` and `/app` (Hermes
      `price_feeds` metadata for the real AAPL feed — schedule only, not a
      price; while the market is set to closed the oracle reads no Pyth
      price account, see below)
- [x] Real-Pyth ingestion proof (`npm run verify:real-pyth`): the oracle's
      open-market path run against a live Pyth SOL/USD account on devnet
      through Pyth's real receiver program, with the on-chain result checked
      against the program's own smoothing math — see "Real-Pyth ingestion proof"
      below
- [ ] Demo recording + hackathon submission (this repo owner's action —
      see "Submission checklist" below)

**Known, disclosed gap:** the "frozen equity feed" side of the replay uses
a derived stand-in, not Pyth's own historical API — see "Pyth Benchmarks
blocker" below. Everything else in Phase 3 (the DEX weekend data, the
on-chain replay, every signature) is real, unmodified real data through
the real deployed programs.

## Toolchain setup

Anchor/Solana program development isn't officially supported natively on
Windows. This repo is built from a Windows host driving a WSL2 Ubuntu
environment for the Rust/Solana/Anchor toolchain:

```
wsl --install -d Ubuntu          # from an elevated PowerShell, reboot if prompted
# inside the Ubuntu shell:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"   # Solana CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 1.2.0 && avm use 1.2.0
```

Then, from the repo root (mounted at
`/mnt/c/Users/HomePC/Documents/vigil` inside WSL):

```
cargo test --workspace       # unit tests, no Solana toolchain needed
anchor build                 # compiles to programs/*/target/deploy/*.so
anchor test --provider.cluster localnet   # Surfpool-backed integration tests
```

Anchor 1.0+ defaults `anchor test` to Surfpool instead of the legacy
`solana-test-validator`; install it with `curl -sL https://run.surfpool.run/
| bash` if `surfpool --version` doesn't resolve (`anchor test --validator
legacy` is the fallback if you'd rather not add it).

## Devnet deployment / seeding / demo

```
anchor deploy --provider.cluster devnet   # needs a funded ~/.config/solana/id.json
npm run seed:devnet                        # creates mints, initializes oracle + reserve
npm run demo:devnet                        # runs the full deposit/borrow/liquidate/repay lifecycle
npm run refill:vault                       # tops the mock-USDC debt vault back up (--dry-run to just read it)
```

The test-token faucet (`/api/faucet`) mints 10 AAPLx per request and is limited to one
request per wallet per 30 minutes, five per connection per hour and sixty per hour overall,
because each mint spends the mint authority's devnet SOL and unlimited AAPLx would let one
caller borrow the market's whole USDC balance. It stops with a clear message if the mint
authority drops below 0.02 SOL. The limits are in-memory (they reset when the server restarts).

`seed-devnet.ts` writes `scripts/devnet-config.json` (addresses) and prints
the `NEXT_PUBLIC_*` lines for `app/.env.local`. `devnet-demo.ts` persists
its test wallets under `scripts/devnet-demo-keys/` (gitignored) so re-runs
don't need re-funding, and writes every signature it produces to
`scripts/devnet-demo-signatures.json`.

## Replay harness (Phase 3)

```
npm run replay:fetch     # pulls real GeckoTerminal OHLCV for the configured weekend
npm run replay:run       # replays it through the live devnet programs (resumable)
npm run replay:compare   # builds the 3-way comparison from that one dataset
cp scripts/replay/comparison-output.json app/public/   # for the /replay page
```

### Pyth Benchmarks blocker (read this before trusting the anchor prices)

The brief calls for the closure-mode "frozen" anchor to come from Pyth's
Benchmarks API. As built, both `benchmarks.pyth.network/v1/updates/price/{ts}`
and `hermes.pyth.network/v2/updates/price/{ts}` return `401 Unauthorized`
for every timestamp tested — including one from an hour before the request,
ruling out a data-availability issue — and the free TradingView-shim
history endpoint the original `.env.example` referenced 404s (retired).
Neither is reachable without an API key, which wasn't available here.

**Current source (`scripts/replay/config.ts`, `SOURCE = "gecko-derived"`):**
the Friday-close and Monday-reopen anchor prices are read from the real,
currently-trading AAPLx/USDC pool (GeckoTerminal) at the candle nearest
each real NYSE close/open moment. This is a faithful stand-in — AAPLx is
arbitraged against real AAPL during market hours, so its DEX price tracks
Pyth's equity print closely right at the close/open boundary — not a
literal Pyth read. Both anchor values are held in exactly two named
constants, never hardcoded elsewhere; every other replay script calls
`getFridayCloseAnchorUsd()` / `getMondayReopenAnchorUsd()` rather than
reading a price directly.

**To switch to real Pyth data once a Benchmarks API key is available:**
flip `SOURCE` to `"pyth-benchmarks"` in `config.ts`, fill in
`PYTH_FRIDAY_CLOSE_PRICE_USD` / `PYTH_MONDAY_OPEN_PRICE_USD` from a real
Benchmarks query against `PYTH_AAPL_FEED_ID` (already the real, confirmed
feed id), and re-run `replay:run` — nothing else changes.

### Real replay signatures (a sample — all 149 are in `scripts/replay/replay-output.json`)

| Step | Signature |
|---|---|
| Close (`set_regime false`), anchor captured at $328.80 | `4gsGsY5eNVQHbUevHCn9LYow67CcV59pM6UiTcbpuiDwgMjk6kSRiZ4q83CU2mUi87kfygHyCmJhwjijc87yWyEv` |
| First weekend tick (2026-09-11T19:00Z, dex=$332.72) | `5gG88ZCsSF2J3yPuLrmEkMS14dgPDKFxDzxMjh753JMQJHdmmNPVTGGxyTbfGbxKMKV3y9coS2Vmujza1nmk33t` |
| Last weekend tick (2026-09-14T14:00Z, dex=$333.37) | `5g7bcFRBwVjkZCpmBQWLaMAziq22BhK2A3aTeM4gyoDRXZxR8483b9XGsmSfcHVTJFJ6EnWMJU68ZnjmFxBBAooN` |
| Reopen (`set_regime true`) | `31xGGqZpuzxLoJ7qALA3ZJqEUABxiqCnj1kf8DbHWeXena8gMYFFJFQ64b9tf861LT2H41SQHpDuND21y2rja2QE` |

Result, from that one real dataset: through the real weekend the raw DEX
price swung $328.27&ndash;$337.74 (2.9%); Vigil's Borrow-Limit Price stayed
conservative at $314.62&ndash;$328.81 (never chased the swing up); its
Liquidation Price widened protectively to $332.87&ndash;$359.63 (never
tightened into the swing); a frozen-price vault would have sat flat at
$332.01 all weekend then jumped 1.47% discontinuously the instant it
reopened.

### Signature verification: 298/298, programmatically confirmed

`npm run replay:verify` reads every signature out of `replay-output.json`
(149 ticks &times; up to 3 signatures each = 298 unique) and checks each
one's real finalization status via `getSignatureStatuses`, not a spot
check of a handful:

```
298 unique signatures.
=== Finalization status breakdown ===
  finalized: 298
298 / 298 unique signatures confirmed FINALIZED.
```

Full per-signature output: `scripts/replay/signature-verification.json`.

### Real bugs found while building the replay harness (fixed, not just described)

1. **`update_price`'s optional `priceUpdate` account**: the generated TS
   Accounts type rejects `priceUpdate: null` at compile time, but Anchor's
   runtime resolver requires exactly that (omitting the key entirely fails
   at runtime with `Account priceUpdate not provided`). Neither the local
   Surfpool suite nor the devnet demo had ever exercised the closed-market
   `update_price` call without a price account — this was a genuinely
   untested code path until the replay hit it. Fixed with an explicit,
   documented type-cast rather than fighting the generated types.
2. **Resume-safety gap in the warmup loop**: on a re-run after the market
   was already closed, the harness's warm-up step re-entered unconditionally
   and would have driven a real `update_price` call down the *closed*-market
   path with stale state. It happened to be harmless the one time it fired
   (posted liquidity was still zero, so the blend had no pull), but was a
   real latent bug for any later resume. Fixed by checking live on-chain
   `is_open` before entering the warm-up loop at all.
3. **Public devnet RPC flakiness**: `api.devnet.solana.com` intermittently
   failed with connect timeouts across a ~180-transaction sequential replay.
   Not a code bug, but real enough to need handling: added per-call retry
   with backoff and made the whole harness resumable (every tick's real
   signature is written to `replay-output.json` immediately, so a crash
   loses no completed work and a re-run picks up exactly where it stopped).

## Repository layout

- `programs/regime_oracle` — Pyth ingestion + anchor-decay-clamp pricing.
- `programs/lending_market` — isolated collateral/borrow/liquidate market.
- `programs/mock_pyth` — test/devnet-demo-only Pyth `PriceUpdateV2` writer;
  **never** a mainnet dependency. See its module doc comment and
  `RegimeState.pyth_receiver_program`'s doc comment for why it exists: this
  MVP has no live Hermes keeper wired up (out of scope -- a real-time
  off-chain keeper process is separate infrastructure from what's built
  here), so local tests, the devnet demo, and the replay harness all
  configure the oracle to trust this program's accounts instead of Pyth's
  real Receiver program. The on-chain verification logic (staleness bound,
  feed-id check, owner check, fully-verified check) is unchanged either way.
- `app/` — Next.js frontend: wallet-adapter connect, live dashboard
  reading `RegimeState`/`Reserve`/`Position` on-chain, deposit/borrow/repay
  forms (`/app`), the landing page (`/`), and the real-data weekend replay comparison chart (`/replay`).
- `scripts/` — devnet seed/demo scripts, plus `scripts/replay/` (the Phase
  3 historical replay harness: `config.ts`, `anchor-price.ts`,
  `fetch-historical-data.ts`, `run-replay.ts`, `build-comparison.ts`).
- `tests/` — Anchor/Surfpool integration tests (`lending_market.ts`) plus
  shared mint/ATA helpers (`utils.ts`).

## Devnet addresses

| Program | Address |
|---|---|
| `regime_oracle` | `7PHoqxS9CQxy6vTmDCEqkmB1oNCeCotxFSPg3rKmDQUV` |
| `lending_market` | `nKD282jg8NPnVLv5hhPrRk8XRfkan8xj73KP6fNTK5K` |
| `mock_pyth` (test/demo-only, see above) | `BA6ND81qDqr1spCJsdkQk92Q7wzanvLYBRijSiY9h7Xw` |

| Mint (devnet, this deployment) | Address |
|---|---|
| AAPLx-equivalent collateral (Token-2022, ScaledUiAmount) | `EJqyqNum9aovpqsAWQY8XhDC4uaJ3sQtPyJ6KqxdZ8KA` |
| Mock USDC (debt, plain SPL Token) | `CKE1TKKwbHbg6UNbpivkakdt7whbyZEYRXrxbRCuSSDW` |

**Note the distinction:** the AAPLx mint above is a *test mint this build
created* for the devnet reserve — the lending mechanics (deposit/borrow/
liquidate/repay) all run against it. The Phase 3 replay's *price data*
instead comes from the real, currently-trading production AAPLx token and
its real DEX pool (neither created nor controlled by this build):

| Real mainnet AAPLx (source of the replay's price data) | Address |
|---|---|
| AAPLx mint | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` |
| AAPLx/USDC pool (DEX: byreal, not Raydium — the brief's example pool address was Raydium, but this is the real pool GeckoTerminal indexes for this token) | `EHdow7Yhmr1ac8Qff9Co1LhSosr38puA6zLd4cbJLdpV` |

### Real devnet transaction signatures (finalized, verified via `solana confirm`)

| Flow | Signature |
|---|---|
| Deposit | `3ryiWepoZrKfk8gBFQj6VxMNbeVd1dyWGLZ6VLArrHwEfjALG7uYmEacZrgHL1nLuefMKsFpGaoXNk1zJ6UETFCB` |
| Borrow (up to live Borrow-Limit-Price limit) | `4fL8ByZc7tag4CFvXNMJQPxW5ybuHWJiAyY78rrfM5oxtB5TDnoSeYPcbG4nER548kj2Ufqpz3tzC9kscuRMViAS` |
| **Liquidate** (by a second wallet) | `5TqwmhS1WtzjbTWc62AeaZkNqPKUrFyNzjvsXt9sF4TPT6PjDyDmtqLxwstPJ1pV6QTttHQtK35gDAxJUbW1oXoD` |
| Repay (fully closes debt) | `9zFga2tH3MdquV16kDodgyQwQ47pX9qFwtp9PJvio12TFkk2SkXUJbaChVmxTUSchVTb9RcUxV2wLVV6b1WgoCc` |
| Withdraw (returns remaining collateral) | `5ko34L9YGe3YSEV9Nrxt8oXt8LSSMCNnhKJGn4UYe1QyCHvKSaMFdo3PiPiVP2U5kwWsXiLeqXb8REpwcF1kVd53` |

Plus the 298 real, programmatically-verified-finalized Phase 3 replay
signatures in `scripts/replay/replay-output.json` (see above).

## Real bugs found and fixed while building this (not just described)

Kept here because they're the kind of thing a description of "tests pass"
would otherwise hide:

1. **Pyth account owner check was backwards.** `update_price` originally
   used `Account<'info, PriceUpdateV2>`, which — since `PriceUpdateV2` is
   defined via `#[account]` inside `regime_oracle` itself — required the
   account be owned by *our own program*, not Pyth's. That would have
   rejected every real Pyth account in production. Fixed by making the
   owner program configurable per `RegimeState` (`pyth_receiver_program`)
   and checking it explicitly instead of relying on Anchor's automatic
   owner derivation.
2. **`liquidate` and `initialize_reserve` each had only one `token_program`
   account field**, but both move Token-2022 collateral *and* legacy-Token
   debt in the same instruction. Fixed by splitting each into
   `collateral_token_program` / `debt_token_program`.
3. **Local validator (Surfpool) Clock isn't wall-clock synced.** Tests that
   used `Date.now()` for Pyth `publish_time` intermittently failed
   staleness checks because the on-chain `Clock` sysvar doesn't track host
   time. Fixed by reading the Clock sysvar directly in tests instead.

## Deviation-band baseline and the hypothetical stress test (`/replay`)

- **Deviation-band baseline** (`npm run replay:compare`): a generic circuit-breaker model computed from the
  same real DEX data: it accepts the DEX price only while within a band of the Friday close and holds the last
  accepted price otherwise. **Chainlink's documentation prescribes no numeric band**; its only figures are
  descriptive (session-transition jumps "typically 1-2%", spikes of "10-20%+"), so the width is chosen *from* that
  range, not recommended by it. The narrow end (+/-1%) is drawn (breaker holds on 12 of 61 ticks); at +/-2% it
  never trips this weekend and equals the DEX-only line. It is a model, not any specific protocol's implementation.
- **Stress test** (`npm run replay:stress`, reads the deployed Reserve from devnet): **hypothetical, not
  historical**. The only invented input is the gap size; reserve parameters, weekend prices and the oracle's update
  rule are the deployed ones. Findings at the deployed reserve (90% max LTV, 92% liquidation threshold, 5% bonus):
  a position opened at the maximum LTV against the weekend's peak Borrow-Limit Price becomes insolvent at a gap of
  about 10.9% (about $23.9k of bad debt per $1M at a 13% gap, the size of Apple's Mar 13 to Mar 16 2020 weekend
  gap, citing StatMuse split-adjusted data). **That threshold is set by the LTV, not by the widened Liquidation
  Price**: past it no liquidator can profit at any Liquidation Price. The widened price adds delay (9 to 13
  oracle updates before liquidation can execute at 5 to 10% gaps). Assumptions and non-modelled effects are on the
  page and in `scripts/replay/stress-test.ts`.

## Demo-mode oracle refresh (on-demand, disclosed)

`borrow`, `withdraw` and `liquidate` reject with `StaleOraclePrices` unless
`RegimeState.last_update_ts` is within 180 s, and this build runs no
continuously-running keeper. So the dashboard calls `POST /api/refresh-oracle`
just before Borrow. The route:

- makes one permissionless `update_price` call on the **closed-market** path,
  which blends the anchor with the **DEX reference price already stored
  on-chain from the Sept 11&ndash;14 replay** &mdash; a stored price, **not a live
  one**, and nothing new is posted;
- never calls `set_regime` and makes no market-hours judgement; it does
  nothing while the on-chain regime is open (the open path needs a Pyth-shaped
  price account, which is out of scope), in which case Borrow shows the
  stale-oracle error;
- checks the on-chain age first and refreshes only if the oracle is older than
  60 s, so it sends at most one transaction per minute however often it is hit,
  and concurrent callers share one in-flight refresh;
- signs with a dedicated **throwaway devnet key** (`CRANK_SECRET_KEY` JSON
  array, or `CRANK_KEYPAIR_PATH` locally), never the deployer or keeper key,
  and has no fallback to any other key. `update_price` is permissionless, so
  the key only needs a few cents of devnet SOL; if unset, the route returns 503
  and Borrow simply surfaces the stale-oracle error.

The Borrow transaction also creates the borrower's USDC token account
(idempotently) when it does not exist yet; the program requires it, and a
first-time wallet would otherwise fail with `AccountNotInitialized`.

`npm run oracle:refresh` does the same refresh from the command line if you
want to warm the oracle manually before a recording take.

**Faucet key:** the "Get Test AAPLx" faucet signs with a disposable key that
holds only the AAPLx `MintTokens` authority (`MINT_AUTHORITY_SECRET_KEY`). It
was rotated on Sept 18 after the previous key's secret was exposed; the mint
authority is now `AfH8S3TU2vFVH6b6Z63vL5pmtK4fX5b3jsakHhjG6HSc`.

## Devnet-only simplifications (disclosed, not hidden)

- `mock_pyth` stands in for Pyth's real Solana Receiver program — see
  above. Its `set_price` only accepts the writer that created a price account (an
  unauthorised write fails with `UnauthorizedWriter`); before that check, anyone could overwrite a
  price account the oracle trusts as a "Pyth" input. Deployed to devnet as an upgrade
  (`3NwSmYHx18CmLQc4Qw9Zu99KxjJj6TJa4dpct6fZtGvH7ktu5DwHkSXpcZK7ffMkUc4pLwdLXrmV2XRHDfAVZXgV`, code hash
  `bb116ced…`); a different writer is rejected and the original writer still works on devnet.
- The debt vault is pre-seeded with mock-USDC liquidity by the deployer,
  standing in for real lender deposits (no lender-deposit flow exists in
  this MVP; out of scope per the brief). No interest accrues on borrows.
- A liquidation repays a position's full debt and seizes collateral capped at
  what the position holds; a shortfall beyond that is not socialized.
- While the market is set to closed (the deployed state), `update_price` reads
  no Pyth account at all: prices come from the closed-market blend of the
  oracle's anchor and the DEX reference stored on-chain from the replay. `mock_pyth`
  fed only the replay's 86 warm-up ticks and its reopen tick.

## Collateral multiplier (Token-2022 scaled UI amount)

The collateral mint carries the scaled-UI-amount extension, and the lending program values collateral as
base amount × multiplier. The dashboard applies the same multiplier (same rule as the program: the new
multiplier once its effective timestamp has passed) for the wallet balance, deposited collateral, borrow
limit, health factor and deposit/withdraw amounts, and sends exact base amounts for "Max". The deployed
AAPLx mint's multiplier is 1.0, which would have hidden a mistake, so `npm run dev:market` creates an isolated
devnet market with any multiplier (`-- --multiplier 1.5 --price 300 --borrower-key <path>`) for testing the
dashboard against it. Against a 1.5× mint: the wallet showed 15.0000 for 10,000,000 base, "Max" deposited exactly
10,000,000 base, max borrowable matched the chain formula ($4,049.97), Borrow at that limit succeeded on-chain, and
typing "3" deposited 2,000,000 base.

## Measured liquidation economics (one real liquidation on devnet)

`npm run experiment:liquidation` builds an isolated devnet market (its own mints, oracle instance and
reserve) with the live reserve's parameters (90% max LTV, 92% liquidation threshold, 5% bonus), opens a
max-LTV position at a $373 price, drops the market price to $333, and executes the real `liquidate`
instruction at the first tick where the position is liquidatable. Result
([`scripts/liquidation-experiment.json`](scripts/liquidation-experiment.json)):

| | |
|---|---|
| Liquidation Price at the first liquidatable tick (it lags the market) | $363.94 |
| Market price | $333.00 |
| Liquidator paid | 335.687750 USDC |
| Liquidator received | 0.968495 AAPLx (worth $322.51 at $333) |
| **Liquidator result** | **−$13.18, −3.93%** |

Confirmed from the finalized transaction's own token balances
(`2o5kkshuvjJLD6UGURUvZde49HcTdk5czH4sLAPqyiqvQ3EUjGyKxACdqbTg6sfP3HvhRzm3eo5HRN6jsVWJofBD`). The program
seizes collateral at the Liquidation Price less the 5% bonus, so a liquidation only pays once the
Liquidation Price is at or below market ÷ 0.95 ($350.53 here). Until then a liquidator has no incentive
to act while the position is under-collateralized. Separately, while the market is set to closed the
Liquidation Price stays above the Borrow-Limit Price, so a position borrowed within the limit is not
liquidatable at all. The market in this run is fed by `mock_pyth` in the open path; only the price
feed differs from the deployed reserve.

## Real-Pyth ingestion proof

Pyth's AAPL price accounts on devnet were last updated on July 2 and Hermes' price
endpoints need a key, so there is no live AAPL price to read. Pyth's sponsored push
feeds for SOL/USD and BTC/USD are live on devnet (about every five minutes), so
`npm run verify:real-pyth` creates a separate oracle state for the SOL/USD feed with
`pyth_receiver_program` set to Pyth's real receiver (`rec5EKMG…`), waits for a fresh
publish, and runs `update_price` against Pyth's own account. It then checks that the
anchor equals Pyth's price exactly and that the borrow-limit and liquidation prices equal
the program's smoothing (price −/+ confidence, eased 5% / 15%, clamped 3%) applied to the
prior state. Result: [`scripts/real-pyth-proof.json`](scripts/real-pyth-proof.json),
transaction `5TiH4tmBGozaPA6hKZc6UHvgeKtuxxaRh7CZh385jVmxo8UbKTpd2Y5xwt2LLDynqQWvJbJwJ7K11YdQLT9ycmgA`
(finalized). This verifies the ingestion code path, not an AAPL market.

## Future work / known limitations

- A live keeper, one that posts a live DEX price and sets the market regime from
  Pyth's published schedule, is the known next step and isn't built: while that
  schedule says open, the oracle's open path needs a real Pyth AAPL price account,
  and Pyth's AAPL account on devnet was last updated on July 2.
- A live keeper could automatically re-run the replay harness against the
  most recently closed weekend on an ongoing basis, keeping `/replay`
  continuously current instead of fixed to one historical window. This is
  explicitly out of scope for this MVP per the brief's Section 6 (no
  continuously-running keeper) and isn't being built now given the
  deadline — noted here as an idea for later, not a commitment.

## Submission checklist (Phase 4)

Everything above this line is built, tested, and verified from within
this environment. The items below are not — they require either a GitHub
account with push access, a screen recording, or an account on Stocklana's
own submission platform, none of which this environment has:

- [x] Code complete, tested, deployed to devnet, replayed against real
      historical data, all disclosures in place.
- [ ] **Push this repository to a real GitHub remote** and get a public
      (or judge-accessible) URL. Not done here — needs a `git remote add
      origin <url>` and `git push` with real credentials this environment
      doesn't have.
- [ ] **Record the demo video** following the brief's Section 7 flow
      (Steps 1&ndash;5), stating on screen and in the written submission
      notes that **Branch B (Demo Mode — "market hours set by hand, price refresh uses stored replay data" on screen)** ran for Step 1 — not Branch A —
      because this build has no live continuously-running Hermes keeper
      verifying real NYSE hours at record time (see the Devnet status strip
      on `/app` for the exact wording to read aloud or caption). Steps 2&ndash;5
      should show the `/replay` page with its "Weekend replay" heading and
      Sept 11&ndash;14, 2026 dates already visible on screen.
- [ ] **Submit to Stocklana** with the GitHub link, the demo video/live-
      demo link, and the branch statement above, per their submission
      form. This is an external platform action outside this environment.

**Before each recording take:** run `npm run oracle:refresh` (from WSL, where
the funded devnet wallet lives). Borrow/withdraw/liquidate reject with
`StaleOraclePrices` unless the oracle was updated within the last 180 s, and
this build runs no continuous keeper, so the refresh opens a ~3-minute window
in which Borrow works. It is one permissionless closed-market `update_price`
call using the DEX reference price already stored on-chain; it does not touch
`set_regime`. Deposit and repay need no refresh.

None of the three unchecked items can be completed from a local dev
environment without the repo owner's own GitHub/recording/platform
credentials — flagging that explicitly rather than marking this "done"
while those are still outstanding.
