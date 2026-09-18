/**
 * Standalone re-run of devnet-demo.ts's Scenario B (deposit -> borrow ->
 * repay -> withdraw) only, reusing the wallets/config that
 * `npm run demo:devnet` already created and funded. Exists because a
 * transient devnet RPC "Blockhash not found" hiccup interrupted the first
 * combined run right after Scenario A (deposit/borrow/liquidate)
 * succeeded -- re-running the whole script would have double-executed
 * Scenario A instead of just retrying the part that actually failed.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import { ensureAta, mintTokens, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../tests/utils";

import regimeOracleIdl from "../target/idl/regime_oracle.json";
import lendingMarketIdl from "../target/idl/lending_market.json";

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}
function loadDeployerKeypair(): Keypair {
  const p = (process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json").replace(/^~/, process.env.HOME ?? "");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "devnet-config.json"), "utf-8"));
  const connection = new Connection(config.rpc, "confirmed");
  const payer = loadDeployerKeypair();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const lendingMarket = new anchor.Program(lendingMarketIdl as anchor.Idl, provider);

  const collateralMint = new PublicKey(config.collateralMint);
  const debtMint = new PublicKey(config.debtMint);
  const regimeState = new PublicKey(config.regimeState);
  const reserve = new PublicKey(config.reserve);
  const [reserveAuthority] = PublicKey.findProgramAddressSync([Buffer.from("reserve_authority"), reserve.toBuffer()], lendingMarket.programId);
  const [collateralVault] = PublicKey.findProgramAddressSync([Buffer.from("collateral_vault"), reserve.toBuffer()], lendingMarket.programId);
  const [debtVault] = PublicKey.findProgramAddressSync([Buffer.from("debt_vault"), reserve.toBuffer()], lendingMarket.programId);

  const borrowerB = loadKeypair(path.join(__dirname, "devnet-demo-keys/borrowerB.json"));
  console.log(`borrowerB: ${borrowerB.publicKey.toBase58()}`);

  const borrowerBCollateralAta = await ensureAta(connection, payer, collateralMint, borrowerB.publicKey, TOKEN_2022_PROGRAM_ID);
  const borrowerBDebtAta = await ensureAta(connection, payer, debtMint, borrowerB.publicKey, TOKEN_PROGRAM_ID);
  const [positionB] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), reserve.toBuffer(), borrowerB.publicKey.toBuffer()],
    lendingMarket.programId,
  );

  const signatures: Record<string, string> = JSON.parse(
    fs.existsSync(path.join(__dirname, "devnet-demo-signatures.json"))
      ? fs.readFileSync(path.join(__dirname, "devnet-demo-signatures.json"), "utf-8")
      : "{}",
  );

  const existingPosition = await connection.getAccountInfo(positionB);
  if (!existingPosition) {
    console.log("[B] deposit");
    await mintTokens(connection, payer, collateralMint, borrowerBCollateralAta, payer, 5_000_000n, TOKEN_2022_PROGRAM_ID);
    signatures.depositB = await lendingMarket.methods
      .deposit(new BN(5_000_000))
      .accounts({
        owner: borrowerB.publicKey,
        reserve,
        position: positionB,
        collateralMint,
        ownerCollateralAta: borrowerBCollateralAta,
        collateralVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([borrowerB])
      .rpc();
    console.log(`  deposit signature: ${signatures.depositB}`);
  }

  let positionBAccount: any = await (lendingMarket.account as any).position.fetch(positionB);
  if (positionBAccount.debtAmount.eqn(0)) {
    console.log("[B] borrow");
    signatures.borrowB = await lendingMarket.methods
      .borrow(new BN(50_000_000))
      .accounts({
        owner: borrowerB.publicKey,
        reserve,
        position: positionB,
        regimeState,
        collateralMint,
        debtMint,
        ownerDebtAta: borrowerBDebtAta,
        debtVault,
        reserveAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([borrowerB])
      .rpc();
    console.log(`  borrow signature: ${signatures.borrowB}`);
    positionBAccount = await (lendingMarket.account as any).position.fetch(positionB);
  }

  console.log("[B] repay");
  signatures.repay = await lendingMarket.methods
    .repay(positionBAccount.debtAmount)
    .accounts({
      owner: borrowerB.publicKey,
      reserve,
      position: positionB,
      debtMint,
      ownerDebtAta: borrowerBDebtAta,
      debtVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([borrowerB])
    .rpc();
  console.log(`  repay signature: ${signatures.repay}`);

  console.log("  waiting out the 60s position-hold-time guard before withdrawing...");
  await new Promise((r) => setTimeout(r, 65_000));

  const positionBAfterRepay: any = await (lendingMarket.account as any).position.fetch(positionB);
  console.log("[B] withdraw");
  signatures.withdraw = await lendingMarket.methods
    .withdraw(positionBAfterRepay.collateralBase)
    .accounts({
      owner: borrowerB.publicKey,
      reserve,
      position: positionB,
      regimeState,
      collateralMint,
      ownerCollateralAta: borrowerBCollateralAta,
      collateralVault,
      reserveAuthority,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([borrowerB])
    .rpc();
  console.log(`  withdraw signature: ${signatures.withdraw}`);

  fs.writeFileSync(path.join(__dirname, "devnet-demo-signatures.json"), JSON.stringify(signatures, null, 2));
  console.log("\n=== Updated scripts/devnet-demo-signatures.json ===");
  console.log(JSON.stringify(signatures, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
