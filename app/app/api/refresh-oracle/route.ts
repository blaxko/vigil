import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";

import regimeOracleIdl from "@/lib/idl/regime_oracle.json";
import { FEED_ID, RPC_ENDPOINT } from "@/lib/constants";
import { regimeStatePda } from "@/lib/pda";

/**
 * Demo-mode oracle refresh, called by the dashboard just before Borrow.
 *
 * Why it exists: `borrow`/`withdraw`/`liquidate` reject with StaleOraclePrices
 * unless RegimeState.last_update_ts is within 180 s of the on-chain clock, and
 * this build has no continuously-running keeper. This route makes one
 * permissionless `update_price` call on the CLOSED-market path, which blends
 * the anchor with the DEX reference price ALREADY STORED on-chain (from the
 * Sept 11-14 weekend replay). It posts no new price, is not a live feed, and
 * makes no market-hours judgement: it never calls set_regime and does nothing
 * at all while the on-chain regime is open (the open path needs a Pyth-shaped
 * price account, which is out of scope here).
 *
 * Safety: `update_price` is permissionless, so the signer is a dedicated
 * throwaway devnet key with a tiny SOL balance -- never the deployer wallet or
 * the keeper. There is deliberately NO fallback to ~/.config/solana/id.json.
 * Spend is bounded: the on-chain age is checked first and a refresh only
 * happens if the oracle is older than REFRESH_IF_OLDER_THAN_SECS, so at most
 * one transaction per minute no matter how often this route is hit, and
 * concurrent callers share a single in-flight refresh.
 */

export const dynamic = "force-dynamic";

const MAX_ORACLE_AGE_SECS = 180; // mirrors lending_market::oracle::MAX_ORACLE_AGE_SECS
const REFRESH_IF_OLDER_THAN_SECS = 60; // refresh early so a Borrow right after still has >=2 min of headroom
const MIN_RETRY_AFTER_FAILURE_MS = 10_000;

type RefreshResult =
  | { refreshed: true; ageSecsBefore: number; signature: string }
  | { refreshed: false; reason: "fresh" | "regime-open"; ageSecs: number };

let inflight: Promise<RefreshResult> | null = null;
let lastFailureAtMs = 0;

/** Anchor's `Wallet` class isn't exported from the bundled build Next uses for
 * route handlers, so sign with a minimal wallet object instead. */
function keypairWallet(kp: Keypair) {
  const sign = async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  };
  return {
    publicKey: kp.publicKey,
    signTransaction: sign,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> =>
      Promise.all(txs.map((t) => sign(t))),
  };
}

function loadCrankKey(): Keypair | null {
  const raw = process.env.CRANK_SECRET_KEY;
  if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  const p = process.env.CRANK_KEYPAIR_PATH;
  if (!p) return null;
  const resolved = path.resolve(p.replace(/^~/, os.homedir()));
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf-8"))));
}

async function refreshOnce(crank: Keypair): Promise<RefreshResult> {
  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const provider = new AnchorProvider(connection, keypairWallet(crank), { commitment: "confirmed" });
  const program = new Program(regimeOracleIdl as Idl, provider);
  const regimeState = regimeStatePda(FEED_ID!);

  const state: any = await (program.account as any).regimeState.fetch(regimeState);
  const nowTs = (await connection.getBlockTime(await connection.getSlot("confirmed"))) ?? Math.floor(Date.now() / 1000);
  const ageSecs = nowTs - state.lastUpdateTs.toNumber();

  if (state.isOpen) return { refreshed: false, reason: "regime-open", ageSecs };
  if (ageSecs <= REFRESH_IF_OLDER_THAN_SECS) return { refreshed: false, reason: "fresh", ageSecs };

  const signature = await program.methods
    .updatePrice()
    // The generated Accounts type rejects `priceUpdate: null`, but the program
    // requires an explicit null on the closed path (same documented cast the
    // replay harness and scripts/refresh-oracle.ts use).
    .accounts({ cranker: crank.publicKey, regimeState, priceUpdate: null } as any)
    .rpc();
  return { refreshed: true, ageSecsBefore: ageSecs, signature };
}

export async function POST() {
  try {
    if (!FEED_ID) {
      return NextResponse.json({ error: "Oracle refresh not configured: feed id missing." }, { status: 503 });
    }
    const crank = loadCrankKey();
    if (!crank) {
      return NextResponse.json({ error: "Oracle refresh not configured: no crank key set." }, { status: 503 });
    }
    if (Date.now() - lastFailureAtMs < MIN_RETRY_AFTER_FAILURE_MS) {
      return NextResponse.json({ error: "Oracle refresh recently failed; retry shortly." }, { status: 503 });
    }

    if (!inflight) {
      inflight = refreshOnce(crank).finally(() => {
        inflight = null;
      });
    }
    const result = await inflight;
    return NextResponse.json({ ...result, maxOracleAgeSecs: MAX_ORACLE_AGE_SECS });
  } catch (e) {
    lastFailureAtMs = Date.now();
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
