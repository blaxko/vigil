/**
 * One-shot oracle refresh for demo recording.
 *
 * `borrow`, `withdraw` and `liquidate` all reject with StaleOraclePrices
 * unless `RegimeState.last_update_ts` is within MAX_ORACLE_AGE_SECS (180 s)
 * of the current on-chain clock, and nothing in this build runs a
 * continuous keeper. Run this immediately before a take to make the next
 * ~3 minutes of Borrow work:
 *
 *     npm run oracle:refresh
 *
 * What it does: one permissionless `update_price` call on the closed-market
 * path, i.e. the same instruction the replay harness cranked. It blends the
 * anchor with the DEX reference price *already stored on-chain*; it does not
 * post a new reference price, does not touch `set_regime`, and makes no
 * market-hours judgement. Any funded signer may crank `update_price`, so the
 * fee payer is just your normal devnet wallet (ANCHOR_WALLET, default
 * ~/.config/solana/id.json) -- no keeper authority involved.
 *
 * It refuses to run if the on-chain regime is open: the open path needs a
 * Pyth-shaped price account (mock_pyth) and is out of scope for a refresh.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import regimeOracleIdl from "../app/lib/idl/regime_oracle.json";

const PRICE_SCALE = 1_000_000;
const MAX_ORACLE_AGE_SECS = 180; // mirrors lending_market::oracle::MAX_ORACLE_AGE_SECS

function loadKeypair(p: string): Keypair {
  const resolved = p.replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf-8"))));
}

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "devnet-config.json"), "utf-8"));
  const payer = loadKeypair(process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json");
  const connection = new Connection(config.rpc, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  const program = new anchor.Program(regimeOracleIdl as anchor.Idl, provider);
  const regimeState = new PublicKey(config.regimeState);

  const fetchState = () => (program.account as any).regimeState.fetch(regimeState);
  const before: any = await fetchState();
  const nowTs = (await connection.getBlockTime(await connection.getSlot("confirmed"))) ?? Math.floor(Date.now() / 1000);
  const ageBefore = nowTs - before.lastUpdateTs.toNumber();

  console.log(`Regime: ${before.isOpen ? "OPEN" : "closed"} | oracle age before: ${ageBefore}s (limit ${MAX_ORACLE_AGE_SECS}s)`);
  if (before.isOpen) {
    console.error(
      "Refusing: on-chain regime is open, and the open-market update_price path needs a mock_pyth price account. " +
        "This script only refreshes the closed-market path.",
    );
    process.exit(1);
  }

  const sig = await program.methods
    .updatePrice()
    // The generated Accounts type rejects `priceUpdate: null`, but the program
    // (and Anchor's runtime resolver) requires an explicit null on the closed
    // path -- same documented cast the replay harness uses.
    .accounts({ cranker: payer.publicKey, regimeState, priceUpdate: null } as any)
    .rpc();

  const after: any = await fetchState();
  const freshUntil = new Date((after.lastUpdateTs.toNumber() + MAX_ORACLE_AGE_SECS) * 1000);
  console.log(`update_price signature: ${sig}`);
  console.log(
    `Borrow-Limit $${(Number(after.borrowLimitPrice) / PRICE_SCALE).toFixed(2)} | ` +
      `Liquidation $${(Number(after.liquidationPrice) / PRICE_SCALE).toFixed(2)}`,
  );
  console.log(`Oracle is fresh: Borrow works until ${freshUntil.toISOString().slice(11, 19)} UTC (~${MAX_ORACLE_AGE_SECS}s). Record now.`);
}

main().catch((e) => {
  console.error("refresh-oracle failed:", e.message ?? e);
  process.exit(1);
});
