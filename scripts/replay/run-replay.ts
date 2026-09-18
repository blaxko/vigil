/**
 * Replays the real Friday-close-to-Monday-open weekend from
 * historical-data.json through Vigil's actual deployed devnet programs,
 * producing a real on-chain sequence of Borrow-Limit/Liquidation Price
 * updates with real transaction signatures for every tick.
 *
 * Sequencing:
 *   1. Warm the live regime_oracle up to the real Friday-close anchor
 *      price (via mock_pyth + update_price, open-market path) -- this is
 *      the same mechanism a real Friday's live trading would drive.
 *   2. set_regime(false): closes the market. Captures that warmed-up
 *      price as `anchor_price`, exactly as it would on a real close.
 *   3. Replay every real historical hourly candle as a keeper tick:
 *      post_dex_reference(candle.close, REPLAY_POOL_LIQUIDITY_USD) +
 *      update_price() (closed-market anchor-decay-clamp path).
 *   4. set_regime(true) + update_price with the real Monday-open price
 *      (open-market path, one-time wider reopen clamp).
 *
 * Every tick's on-chain state (borrow_limit_price, liquidation_price) and
 * transaction signature is written incrementally to
 * scripts/replay/replay-output.json as it happens, so a partial run is
 * still inspectable and the script is safe to re-run (it does not
 * re-warm past where it already got to -- see WARM_EPSILON_BPS below).
 *
 * Usage: npm run replay:run
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import { HistoricalDataset, REPLAY_POOL_LIQUIDITY_USD } from "./config";
import { anchorSourceDisclosure, getFridayCloseAnchorUsd, getMondayReopenAnchorUsd } from "./anchor-price";
import { onChainUnixTimestamp } from "../../tests/utils";

import regimeOracleIdl from "../../target/idl/regime_oracle.json";
import mockPythIdl from "../../target/idl/mock_pyth.json";

/** Devnet RPC calls intermittently fail with transient errors (seen during
 * this build: undici HEADERS_TIMEOUT) unrelated to program logic. Retries
 * with backoff rather than aborting a ~180-transaction sequential replay
 * over one flaky request. */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 10): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [retry ${i + 1}/${attempts}] ${label} failed: ${msg.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, Math.min(5000 * (i + 1), 30_000)));
    }
  }
  throw lastErr;
}

const PRICE_SCALE = 1_000_000;
const usd = (dollars: number) => new BN(Math.round(dollars * PRICE_SCALE));
const WARM_EPSILON_BPS = 100; // stop warming once within 1% of the target

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p.replace(/^~/, process.env.HOME ?? ""), "utf-8"))));
}

interface ReplayTick {
  step: string;
  candleTimestampUtc?: string;
  dexPriceUsd?: number;
  borrowLimitPriceUsd: number;
  liquidationPriceUsd: number;
  isOpen: boolean;
  txSignatures: string[];
}

async function main() {
  const dataset: HistoricalDataset = JSON.parse(fs.readFileSync(path.join(__dirname, "historical-data.json"), "utf-8"));
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../devnet-config.json"), "utf-8"));

  const connection = new Connection(config.rpc, "confirmed");
  const payer = loadKeypair(process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json");
  const keeperPath = path.join(__dirname, "../../keeper-keypair.json");
  const keeper = loadKeypair(keeperPath);

  // The provider wallet pays every transaction's fee and is the default
  // signer; `keeper` is passed as an explicit additional signer only on
  // the two instructions the program actually requires it for
  // (set_regime, post_dex_reference -- both permissioned to
  // regime_state.keeper_authority). This avoids needing to separately
  // fund the keeper keypair with devnet SOL just to pay its own fees.
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const regimeOracle = new anchor.Program(regimeOracleIdl as anchor.Idl, provider);
  const mockPyth = new anchor.Program(mockPythIdl as anchor.Idl, provider);

  const feedId: number[] = config.feedId;
  const regimeState = new PublicKey(config.regimeState);
  const [mockPriceAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("mock_price"), Buffer.from(feedId)],
    mockPyth.programId,
  );

  const fridayAnchorUsd = getFridayCloseAnchorUsd();
  const mondayReopenUsd = getMondayReopenAnchorUsd();
  console.log(anchorSourceDisclosure());
  console.log(`Friday-close anchor: $${fridayAnchorUsd.toFixed(2)}`);
  console.log(`Monday-reopen anchor: $${mondayReopenUsd.toFixed(2)}`);
  console.log(`Replaying ${dataset.candles.length} real candles from ${dataset.fridayCloseUtc} to ${dataset.mondayOpenUtc}`);

  const outPath = path.join(__dirname, "replay-output.json");
  const ticks: ReplayTick[] = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf-8")) : [];
  const save = () => fs.writeFileSync(outPath, JSON.stringify(ticks, null, 2));

  async function crankOpen(targetUsd: number): Promise<{ sig1: string; sig2: string; state: any }> {
    const now = await withRetry("onChainUnixTimestamp", () => onChainUnixTimestamp(connection));
    const sig1 = await withRetry("mockPyth.setPrice", () =>
      mockPyth.methods
        .setPrice(feedId, usd(targetUsd), usd(targetUsd * 0.0003), -6, new BN(now))
        .accounts({ payer: payer.publicKey, priceUpdate: mockPriceAccount, systemProgram: SystemProgram.programId })
        .rpc(),
    );
    const sig2 = await withRetry("regimeOracle.updatePrice (open)", () =>
      regimeOracle.methods
        .updatePrice()
        .accounts({ cranker: payer.publicKey, regimeState, priceUpdate: mockPriceAccount })
        .rpc(),
    );
    const state = await withRetry("fetch regimeState", () => (regimeOracle.account as any).regimeState.fetch(regimeState));
    return { sig1, sig2, state };
  }

  // --- Step 1: warm up to the real Friday-close anchor (open market) ---
  // Guarded on current on-chain is_open: crankOpen() calls update_price(),
  // which branches on the program's actual regime flag, not on what this
  // script intends -- if a prior run already closed the market, entering
  // this loop again would silently hit the closed-market decay path
  // instead (harmless only by accident before any liquidity is posted;
  // corrupting once Step 3 has posted real dex_reference values). Once
  // closed, warmup no longer applies -- skip straight past it.
  const preState: any = await withRetry("fetch regimeState", () => (regimeOracle.account as any).regimeState.fetch(regimeState));
  if (preState.isOpen) {
    console.log("\n[1] Warming live price to the real Friday-close anchor...");
    for (let i = 0; i < 60; i++) {
      const { sig1, sig2, state } = await crankOpen(fridayAnchorUsd);
      const current = Number(state.borrowLimitPrice) / PRICE_SCALE;
      const gapBps = Math.abs(current - fridayAnchorUsd) / fridayAnchorUsd * 10_000;
      console.log(`  warm tick ${i + 1}: borrow-limit price $${current.toFixed(2)} (target $${fridayAnchorUsd.toFixed(2)}, gap ${gapBps.toFixed(0)}bps)`);
      ticks.push({
        step: "warmup",
        borrowLimitPriceUsd: current,
        liquidationPriceUsd: Number(state.liquidationPrice) / PRICE_SCALE,
        isOpen: true,
        txSignatures: [sig1, sig2],
      });
      save();
      if (gapBps <= WARM_EPSILON_BPS) break;
    }
  } else {
    console.log("\n[1] Market already closed (resumed run) -- skipping warmup.");
  }

  // --- Step 2: close the market ---
  let state: any = await withRetry("fetch regimeState", () => (regimeOracle.account as any).regimeState.fetch(regimeState));
  if (state.isOpen) {
    console.log("\n[2] Closing the market (set_regime false)...");
    const sig = await withRetry("setRegime(false)", () =>
      regimeOracle.methods
        .setRegime(false)
        .accounts({ keeperAuthority: keeper.publicKey, regimeState })
        .signers([keeper])
        .rpc(),
    );
    state = await withRetry("fetch regimeState", () => (regimeOracle.account as any).regimeState.fetch(regimeState));
    console.log(`  signature: ${sig}`);
    console.log(`  anchor_price captured: $${(Number(state.anchorPrice) / PRICE_SCALE).toFixed(2)}`);
    ticks.push({
      step: "close",
      borrowLimitPriceUsd: Number(state.borrowLimitPrice) / PRICE_SCALE,
      liquidationPriceUsd: Number(state.liquidationPrice) / PRICE_SCALE,
      isOpen: false,
      txSignatures: [sig],
    });
    save();
  } else {
    console.log("\n[2] Market already closed (resumed run) -- skipping.");
  }

  // --- Step 3: replay every real historical candle (closed market) ---
  console.log(`\n[3] Replaying ${dataset.candles.length} real historical candles...`);
  const alreadyReplayed = new Set(ticks.filter((t) => t.step === "replay").map((t) => t.candleTimestampUtc));
  for (const candle of dataset.candles) {
    const isoTs = new Date(candle.timestamp * 1000).toISOString();
    if (alreadyReplayed.has(isoTs)) continue;

    const sig1 = await withRetry("postDexReference", () =>
      regimeOracle.methods
        .postDexReference(usd(candle.close), new BN(Math.round(REPLAY_POOL_LIQUIDITY_USD * PRICE_SCALE)))
        .accounts({ keeperAuthority: keeper.publicKey, regimeState })
        .signers([keeper])
        .rpc(),
    );
    const sig2 = await withRetry("regimeOracle.updatePrice (closed)", () =>
      // The generated Accounts type rejects `priceUpdate: null` even
      // though the program (and Anchor's runtime resolver) requires an
      // explicit null -- omitting the key entirely fails at runtime with
      // "Account `priceUpdate` not provided." Cast to bypass the overly
      // strict generated type rather than fight it.
      regimeOracle.methods
        .updatePrice()
        .accounts({ cranker: payer.publicKey, regimeState, priceUpdate: null } as any)
        .rpc(),
    );
    const tickState: any = await withRetry("fetch regimeState", () => (regimeOracle.account as any).regimeState.fetch(regimeState));
    const borrowUsd = Number(tickState.borrowLimitPrice) / PRICE_SCALE;
    const liqUsd = Number(tickState.liquidationPrice) / PRICE_SCALE;
    console.log(
      `  ${isoTs} dex=$${candle.close.toFixed(2)} -> borrow-limit=$${borrowUsd.toFixed(2)} liquidation=$${liqUsd.toFixed(2)}`,
    );
    ticks.push({
      step: "replay",
      candleTimestampUtc: isoTs,
      dexPriceUsd: candle.close,
      borrowLimitPriceUsd: borrowUsd,
      liquidationPriceUsd: liqUsd,
      isOpen: false,
      txSignatures: [sig1, sig2],
    });
    save();
  }

  // --- Step 4: reopen with the real Monday print ---
  state = await withRetry("fetch regimeState", () => (regimeOracle.account as any).regimeState.fetch(regimeState));
  if (!state.isOpen) {
    console.log("\n[4] Reopening the market with the real Monday-open print...");
    const sigRegime = await withRetry("setRegime(true)", () =>
      regimeOracle.methods
        .setRegime(true)
        .accounts({ keeperAuthority: keeper.publicKey, regimeState })
        .signers([keeper])
        .rpc(),
    );
    const { sig1, sig2, state: reopenState } = await crankOpen(mondayReopenUsd);
    const borrowUsd = Number(reopenState.borrowLimitPrice) / PRICE_SCALE;
    const liqUsd = Number(reopenState.liquidationPrice) / PRICE_SCALE;
    console.log(`  set_regime signature: ${sigRegime}`);
    console.log(`  reopen crank signatures: ${sig1}, ${sig2}`);
    console.log(`  borrow-limit after reopen snap: $${borrowUsd.toFixed(2)}, liquidation: $${liqUsd.toFixed(2)}`);
    ticks.push({
      step: "reopen",
      dexPriceUsd: mondayReopenUsd,
      borrowLimitPriceUsd: borrowUsd,
      liquidationPriceUsd: liqUsd,
      isOpen: true,
      txSignatures: [sigRegime, sig1, sig2],
    });
    save();
  } else {
    console.log("\n[4] Market already reopened (resumed run) -- skipping.");
  }

  console.log(`\nDone. ${ticks.length} total ticks written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
