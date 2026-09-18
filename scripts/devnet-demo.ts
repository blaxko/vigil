/**
 * Runs the full lending lifecycle against the already-deployed devnet
 * programs and seeded mints (see `npm run seed:devnet`), producing real
 * devnet transaction signatures for each required flow:
 *   1. deposit  2. borrow  3. liquidate (by a second wallet)  4. repay + withdraw
 *
 * Usage: npm run demo:devnet
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import {
  createScaledUiMint,
  ensureAta,
  mintTokens,
  onChainUnixTimestamp,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../tests/utils";

import regimeOracleIdl from "../target/idl/regime_oracle.json";
import lendingMarketIdl from "../target/idl/lending_market.json";
import mockPythIdl from "../target/idl/mock_pyth.json";

const PRICE_SCALE = 1_000_000;
const usd = (dollars: number) => new BN(Math.round(dollars * PRICE_SCALE));

function loadOrCreateKeypair(p: string): Keypair {
  if (fs.existsSync(p)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

function loadDeployerKeypair(): Keypair {
  const p = (process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json").replace(/^~/, process.env.HOME ?? "");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function fundIfLow(connection: Connection, payer: Keypair, target: PublicKey, minLamports: number) {
  const bal = await connection.getBalance(target);
  if (bal >= minLamports) return;
  const sig = await anchor.web3.sendAndConfirmTransaction(
    connection,
    new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: target, lamports: minLamports - bal }),
    ),
    [payer],
    { commitment: "confirmed" },
  );
  console.log(`  funded ${target.toBase58()} (${sig})`);
}

async function main() {
  const configPath = path.join(__dirname, "devnet-config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("scripts/devnet-config.json not found -- run `npm run seed:devnet` first.");
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  const connection = new Connection(config.rpc, "confirmed");
  const payer = loadDeployerKeypair();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const regimeOracle = new anchor.Program(regimeOracleIdl as anchor.Idl, provider);
  const lendingMarket = new anchor.Program(lendingMarketIdl as anchor.Idl, provider);
  const mockPyth = new anchor.Program(mockPythIdl as anchor.Idl, provider);

  const collateralMint = new PublicKey(config.collateralMint);
  const debtMint = new PublicKey(config.debtMint);
  const feedId: number[] = config.feedId;
  const regimeState = new PublicKey(config.regimeState);
  const reserve = new PublicKey(config.reserve);

  const [reserveAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve_authority"), reserve.toBuffer()],
    lendingMarket.programId,
  );
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault"), reserve.toBuffer()],
    lendingMarket.programId,
  );
  const [debtVault] = PublicKey.findProgramAddressSync([Buffer.from("debt_vault"), reserve.toBuffer()], lendingMarket.programId);
  const [mockPriceAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("mock_price"), Buffer.from(feedId)],
    mockPyth.programId,
  );

  const keysDir = path.join(__dirname, "devnet-demo-keys");
  fs.mkdirSync(keysDir, { recursive: true });
  const borrowerA = loadOrCreateKeypair(path.join(keysDir, "borrowerA.json")); // gets liquidated
  const borrowerB = loadOrCreateKeypair(path.join(keysDir, "borrowerB.json")); // repays normally
  const liquidator = loadOrCreateKeypair(path.join(keysDir, "liquidator.json"));

  console.log("Funding demo wallets from the deployer (avoids devnet faucet rate limits)...");
  await fundIfLow(connection, payer, borrowerA.publicKey, 0.03 * anchor.web3.LAMPORTS_PER_SOL);
  await fundIfLow(connection, payer, borrowerB.publicKey, 0.03 * anchor.web3.LAMPORTS_PER_SOL);
  await fundIfLow(connection, payer, liquidator.publicKey, 0.03 * anchor.web3.LAMPORTS_PER_SOL);

  const signatures: Record<string, string> = {};

  // --- Scenario A: deposit -> borrow -> price crash -> liquidate ---
  console.log("\n[A] borrowerA: deposit");
  const borrowerACollateralAta = await ensureAta(connection, payer, collateralMint, borrowerA.publicKey, TOKEN_2022_PROGRAM_ID);
  const borrowerADebtAta = await ensureAta(connection, payer, debtMint, borrowerA.publicKey, TOKEN_PROGRAM_ID);
  await mintTokens(connection, payer, collateralMint, borrowerACollateralAta, payer, 10_000_000n, TOKEN_2022_PROGRAM_ID);
  const [positionA] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), reserve.toBuffer(), borrowerA.publicKey.toBuffer()],
    lendingMarket.programId,
  );
  signatures.depositA = await lendingMarket.methods
    .deposit(new BN(10_000_000))
    .accounts({
      owner: borrowerA.publicKey,
      reserve,
      position: positionA,
      collateralMint,
      ownerCollateralAta: borrowerACollateralAta,
      collateralVault,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([borrowerA])
    .rpc();
  console.log(`  deposit signature: ${signatures.depositA}`);

  console.log("[A] crank live price ($150) and borrow $1,300");
  {
    const now = await onChainUnixTimestamp(connection);
    await mockPyth.methods
      .setPrice(feedId, usd(150), usd(0.05), -6, new BN(now))
      .accounts({ payer: payer.publicKey, priceUpdate: mockPriceAccount, systemProgram: SystemProgram.programId })
      .rpc();
    await regimeOracle.methods.updatePrice().accounts({ cranker: payer.publicKey, regimeState, priceUpdate: mockPriceAccount }).rpc();
  }
  signatures.borrowA = await lendingMarket.methods
    .borrow(new BN(1_300_000_000))
    .accounts({
      owner: borrowerA.publicKey,
      reserve,
      position: positionA,
      regimeState,
      collateralMint,
      debtMint,
      ownerDebtAta: borrowerADebtAta,
      debtVault,
      reserveAuthority,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([borrowerA])
    .rpc();
  console.log(`  borrow signature: ${signatures.borrowA}`);

  console.log("[A] cranking a real price crash toward liquidation eligibility (per-tick clamped, may take a while)...");
  for (let i = 0; i < 40; i++) {
    const now = await onChainUnixTimestamp(connection);
    await mockPyth.methods
      .setPrice(feedId, usd(40), usd(0.02), -6, new BN(now))
      .accounts({ payer: payer.publicKey, priceUpdate: mockPriceAccount, systemProgram: SystemProgram.programId })
      .rpc();
    await regimeOracle.methods.updatePrice().accounts({ cranker: payer.publicKey, regimeState, priceUpdate: mockPriceAccount }).rpc();

    const state: any = await (regimeOracle.account as any).regimeState.fetch(regimeState);
    const liqPrice: BN = state.liquidationPrice;
    const collateralValue = liqPrice.muln(10); // 10 whole shares, 1.0x multiplier
    const thresholdValue = collateralValue.muln(9200).divn(10_000);
    console.log(`  tick ${i + 1}: liquidation price $${(Number(liqPrice) / PRICE_SCALE).toFixed(4)}`);
    if (new BN(1_300).mul(new BN(PRICE_SCALE)).gte(thresholdValue)) break;
  }

  console.log("[A] liquidator: liquidate");
  const liquidatorDebtAta = await ensureAta(connection, payer, debtMint, liquidator.publicKey, TOKEN_PROGRAM_ID);
  const liquidatorCollateralAta = await ensureAta(connection, payer, collateralMint, liquidator.publicKey, TOKEN_2022_PROGRAM_ID);
  await mintTokens(connection, payer, debtMint, liquidatorDebtAta, payer, 2_000_000_000n, TOKEN_PROGRAM_ID);
  signatures.liquidate = await lendingMarket.methods
    .liquidate()
    .accounts({
      liquidator: liquidator.publicKey,
      reserve,
      position: positionA,
      regimeState,
      collateralMint,
      debtMint,
      liquidatorDebtAta,
      liquidatorCollateralAta,
      collateralVault,
      debtVault,
      reserveAuthority,
      collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
      debtTokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([liquidator])
    .rpc();
  console.log(`  liquidate signature: ${signatures.liquidate}`);

  // --- Scenario B: deposit -> borrow -> repay -> withdraw ---
  console.log("\n[B] borrowerB: deposit, borrow, repay, withdraw");
  const borrowerBCollateralAta = await ensureAta(connection, payer, collateralMint, borrowerB.publicKey, TOKEN_2022_PROGRAM_ID);
  const borrowerBDebtAta = await ensureAta(connection, payer, debtMint, borrowerB.publicKey, TOKEN_PROGRAM_ID);
  await mintTokens(connection, payer, collateralMint, borrowerBCollateralAta, payer, 5_000_000n, TOKEN_2022_PROGRAM_ID);
  const [positionB] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), reserve.toBuffer(), borrowerB.publicKey.toBuffer()],
    lendingMarket.programId,
  );
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

  signatures.borrowB = await lendingMarket.methods
    .borrow(new BN(50_000_000)) // small, safe $50 borrow
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

  const positionBAccount: any = await (lendingMarket.account as any).position.fetch(positionB);
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

  // Hold-time guard (60s, set in seed-devnet.ts) applies to withdraw after
  // a borrow -- wait it out rather than pretending it isn't there.
  console.log("  waiting out the 60s position-hold-time guard before withdrawing...");
  await new Promise((r) => setTimeout(r, 65_000));

  const positionBAfterRepay: any = await (lendingMarket.account as any).position.fetch(positionB);
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
  console.log("\n=== All real devnet signatures (wrote scripts/devnet-demo-signatures.json) ===");
  console.log(JSON.stringify(signatures, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
