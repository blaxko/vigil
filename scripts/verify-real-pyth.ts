/**
 * Runs Vigil's oracle open-market path against a REAL, live Pyth price account on devnet.
 *
 * Why SOL/USD and not AAPL: Pyth's sponsored push-feed accounts on devnet are only kept fresh for
 * some feeds. SOL/USD and BTC/USD update about every five minutes; the AAPL accounts were last
 * updated in July, so there is no live AAPL price to read. This proves the ingestion path, not an
 * AAPL market: a separate RegimeState is created for the SOL/USD feed with `pyth_receiver_program`
 * set to Pyth's real Solana receiver, then `update_price` reads Pyth's own account, applying the
 * owner, feed-id, staleness, positivity and fully-verified checks and the price -/+ confidence bands.
 *
 *   npx ts-node --project tsconfig.json scripts/verify-real-pyth.ts
 *
 * Signs with LAB_KEYPAIR (or ANCHOR_WALLET); needs about 0.01 devnet SOL. Writes scripts/real-pyth-proof.json.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import regimeOracleIdl from "../target/idl/regime_oracle.json";

const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SOL_USD_FEED_HEX = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const MAX_AGE_TO_SEND = 20; // seconds; the program's own bound is 60

function loadKeypair(p: string): Keypair {
  const resolved = p.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? "");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf-8"))));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads Pyth's PriceUpdateV2 account by hand, independently of the program, to compare against. */
function decodePyth(data: Buffer) {
  let o = 8 + 32; // discriminator + write_authority
  const verification = data[o] === 1 ? "Full" : "Partial";
  o += data[o] === 0 ? 2 : 1;
  const feed = data.subarray(o, o + 32).toString("hex");
  o += 32;
  const price = data.readBigInt64LE(o);
  o += 8;
  const conf = data.readBigUInt64LE(o);
  o += 8;
  const expo = data.readInt32LE(o);
  o += 4;
  const publishTime = Number(data.readBigInt64LE(o));
  // To Vigil's 1e6 fixed point, with the same integer division the program uses (normalize_to_micro_usd).
  const pow = expo + 6;
  const micro = (v: bigint) => (pow >= 0 ? v * 10n ** BigInt(pow) : v / 10n ** BigInt(-pow));
  return { verification, feed, priceMicro: Number(micro(price)), confMicro: Number(micro(conf)), expo, publishTime };
}

// The program's own smoothing, reproduced exactly (regime_oracle math.rs), to check the on-chain result.
const emaStep = (cur: bigint, tgt: bigint, alphaBps: bigint) =>
  tgt >= cur ? cur + ((tgt - cur) * alphaBps) / 10_000n : cur - ((cur - tgt) * alphaBps) / 10_000n;
const clampMove = (prev: bigint, prop: bigint, maxBps: bigint) => {
  const d = (prev * maxBps) / 10_000n;
  const lo = prev - d > 0n ? prev - d : 1n;
  const hi = prev + d;
  return prop < lo ? lo : prop > hi ? hi : prop;
};

async function main() {
  const payer = loadKeypair(process.env.LAB_KEYPAIR ?? process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json");
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  const program = new anchor.Program(regimeOracleIdl as anchor.Idl, provider);

  const feedId = Buffer.from(SOL_USD_FEED_HEX, "hex");
  const [pythAccount] = PublicKey.findProgramAddressSync([Buffer.alloc(2), feedId], PYTH_PUSH_ORACLE); // shard 0
  const [regimeState] = PublicKey.findProgramAddressSync([Buffer.from("regime_state"), feedId], program.programId);
  console.log("payer/keeper      :", payer.publicKey.toBase58());
  console.log("Pyth SOL/USD acct :", pythAccount.toBase58());
  console.log("oracle state PDA  :", regimeState.toBase58());

  const info = await connection.getAccountInfo(pythAccount);
  if (!info) throw new Error("Pyth SOL/USD push-feed account not found on devnet");
  if (!info.owner.equals(PYTH_RECEIVER)) throw new Error("account is not owned by Pyth's receiver program");

  if (!(await connection.getAccountInfo(regimeState))) {
    const seed = decodePyth(info.data);
    const sig = await program.methods
      .initialize(Array.from(feedId), new BN(seed.priceMicro), PYTH_RECEIVER)
      .accounts({ payer: payer.publicKey, keeperAuthority: payer.publicKey, regimeState, systemProgram: SystemProgram.programId })
      .rpc();
    console.log("initialized oracle state for SOL/USD, receiver = Pyth's real program:", sig);
  } else {
    console.log("oracle state already exists; reusing it");
  }

  // The push feed refreshes roughly every five minutes, so wait for a fresh publish and crank at once.
  console.log(`waiting for a Pyth update fresher than ${MAX_AGE_TO_SEND}s ...`);
  let pyth = decodePyth((await connection.getAccountInfo(pythAccount))!.data);
  for (let i = 0; i < 400; i++) {
    const chainNow = (await connection.getBlockTime(await connection.getSlot())) ?? Math.floor(Date.now() / 1000);
    pyth = decodePyth((await connection.getAccountInfo(pythAccount))!.data);
    if (chainNow - pyth.publishTime <= MAX_AGE_TO_SEND) break;
    await sleep(2000);
  }

  const before: any = await (program.account as any).regimeState.fetch(regimeState);
  const sig = await program.methods.updatePrice().accounts({ cranker: payer.publicKey, regimeState, priceUpdate: pythAccount }).rpc();
  const after: any = await (program.account as any).regimeState.fetch(regimeState);
  const tx = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  const anchorPrice = Number(after.anchorPrice);
  const borrow = Number(after.borrowLimitPrice);
  const liq = Number(after.liquidationPrice);

  // What the program should have produced: targets are price -/+ confidence, eased 5% / 15% and clamped to 3% per tick.
  const px = BigInt(pyth.priceMicro);
  const cf = BigInt(pyth.confMicro);
  const borrowTarget = px > cf ? px - cf : 1n;
  const liqTarget = px + cf;
  const expBorrow = clampMove(BigInt(before.borrowLimitPrice.toString()), emaStep(BigInt(before.borrowLimitPrice.toString()), borrowTarget, 500n), 300n);
  let expLiq = clampMove(BigInt(before.liquidationPrice.toString()), emaStep(BigInt(before.liquidationPrice.toString()), liqTarget, 1500n), 300n);
  if (expBorrow > expLiq) expLiq = expBorrow;

  const proof = {
    what: "regime_oracle.update_price (open-market path) reading a live Pyth SOL/USD PriceUpdateV2 account on devnet",
    notAapl: "SOL/USD stands in for AAPL: Pyth's AAPL accounts on devnet are not being updated",
    network: "devnet",
    signature: sig,
    explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
    pythAccount: pythAccount.toBase58(),
    pythAccountOwner: info.owner.toBase58(),
    pythPublishTime: new Date(pyth.publishTime * 1000).toISOString(),
    pythVerification: pyth.verification,
    pythPriceUsd: pyth.priceMicro / 1e6,
    pythConfUsd: pyth.confMicro / 1e6,
    oracleAnchorUsd: anchorPrice / 1e6,
    oracleBorrowLimitUsd: borrow / 1e6,
    oracleLiquidationUsd: liq / 1e6,
    before: { borrowLimitUsd: Number(before.borrowLimitPrice) / 1e6, liquidationUsd: Number(before.liquidationPrice) / 1e6 },
    targets: { borrowLimitUsd: Number(borrowTarget) / 1e6, liquidationUsd: Number(liqTarget) / 1e6 },
    checks: {
      anchorEqualsPythPrice: BigInt(anchorPrice) === px,
      borrowLimitMatchesSmoothedPriceMinusConfidence: BigInt(borrow) === expBorrow,
      liquidationMatchesSmoothedPricePlusConfidence: BigInt(liq) === expLiq,
    },
    logs: tx?.meta?.logMessages?.filter((l) => /regime|Instruction|success|failed/i.test(l)),
  };
  fs.writeFileSync(path.join(__dirname, "real-pyth-proof.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
  if (!Object.values(proof.checks).every(Boolean)) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
