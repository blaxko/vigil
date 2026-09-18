# Vigil

Regime-aware lending protocol for tokenized US equities on Solana. See
`Vigil Project Brief 2.md` for the full design rationale, architecture, and
acceptance criteria.

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
- [x] `cargo test --workspace` — **27/27 passing** (17 regime_oracle, 10
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
      market-close and reopen-snap transitions — **149 total ticks, every
      one with a real finalized devnet signature** (`scripts/replay/replay-output.json`)
- [x] Three-way comparison (Vigil / frozen-price vault / DEX-only vault),
      computed from that single real dataset (`npm run replay:compare`,
      rendered at `app/replay`) — never three independently tuned scenarios
- [x] All 298 unique replay signatures programmatically verified finalized
      via `getSignatureStatuses` (`npm run replay:verify`, not a spot check)
      — see `scripts/replay/signature-verification.json`
- [x] Both frontend pages screenshot-verified actually rendering (not just
      "the build passes") — see `screenshots/dashboard-page.png` and
      `screenshots/replay-page-final.png`
- [x] On-screen disclosure labels: Branch A/B state on `/`, the
      "Replaying [date] weekend" badge and GeckoTerminal-anchor-source
      callout on `/replay`
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
```

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

### Frontend screenshots (real renders, not a claim the build passes)

- `screenshots/dashboard-page.png` — `/`, showing the Branch B disclosure
  banner, live market panel, and deposit/borrow/repay forms.
- `screenshots/replay-page-final.png` — `/replay`, showing the "Replaying
  Sept 11&ndash;14 2026 weekend" badge, the GeckoTerminal-anchor-source
  disclosure, and the real four-series comparison chart rendering
  correctly (green Borrow-Limit trending down conservatively, blue
  Liquidation widening protectively, red DEX-only oscillating with the raw
  weekend swing, amber Frozen flat then jumping at reopen).

Both captured with headless Edge against a running `next dev` server,
confirming actual client-side rendering and data fetching, not just that
`next build` exits 0.

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
  feed-id check, owner check) is unchanged either way.
- `app/` — Next.js frontend: wallet-adapter connect, live dashboard
  reading `RegimeState`/`Reserve`/`Position` on-chain, deposit/borrow/repay
  forms (`/`), and the real-data weekend replay comparison chart (`/replay`).
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

## Devnet-only simplifications (disclosed, not hidden)

- `mock_pyth` stands in for Pyth's real Solana Receiver program — see
  above.
- The debt vault is pre-seeded with mock-USDC liquidity by the deployer,
  standing in for real lender deposits (no lender-deposit flow exists in
  this MVP; out of scope per the brief).

## Future work / known limitations

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
      notes that **Branch B (Demo Mode)** ran for Step 1 — not Branch A —
      because this build has no live continuously-running Hermes keeper
      verifying real NYSE hours at record time (see the on-screen banner
      on `/` for the exact wording to read aloud or caption). Steps 2&ndash;5
      should show the `/replay` page with its "Replaying Sept 11&ndash;14
      2026 weekend" label already visible on screen.
- [ ] **Submit to Stocklana** with the GitHub link, the demo video/live-
      demo link, and the branch statement above, per their submission
      form. This is an external platform action outside this environment.

None of the three unchecked items can be completed from a local dev
environment without the repo owner's own GitHub/recording/platform
credentials — flagging that explicitly rather than marking this "done"
while those are still outstanding.
