/**
 * Devnet seed script: creates the AAPLx-equivalent collateral mint (Token-2022
 * with the ScaledUiAmount extension) and a mock-USDC debt mint, then
 * initializes both the regime_oracle RegimeState and the lending_market
 * Reserve against them, and seeds the debt vault with lending liquidity.
 *
 * `pyth_receiver_program` is set to the deployed `mock_pyth` program, not
 * Pyth's real Solana Receiver -- this MVP has no live Hermes keeper wired
 * up yet (that off-chain piece is Phase 3 territory), so the devnet demo
 * uses the same test-only price writer the local integration tests use.
 * The on-chain verification logic itself (staleness bound, feed-id check,
 * owner check) is unchanged and real; only the trusted account's origin is
 * substituted, exactly like the devnet mock-USDC mint substitutes for a
 * real USDC deployment. See regime_oracle::state::RegimeState's doc
 * comment.
 *
 * Usage: npm run seed:devnet
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

import {
  createScaledUiMint,
  createDebtMint,
  mintTokens,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../tests/utils";

import regimeOracleIdl from "../target/idl/regime_oracle.json";
import lendingMarketIdl from "../target/idl/lending_market.json";

const RPC = process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
const PRICE_SCALE = 1_000_000;
const usd = (dollars: number) => new BN(Math.round(dollars * PRICE_SCALE));

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p.replace(/^~/, process.env.HOME ?? ""), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const payer = loadKeypair(process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json");
  console.log(`Deployer/payer: ${payer.publicKey.toBase58()}`);
  console.log(`Balance: ${(await connection.getBalance(payer.publicKey)) / anchor.web3.LAMPORTS_PER_SOL} SOL`);

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const regimeOracle = new anchor.Program(regimeOracleIdl as anchor.Idl, provider);
  const lendingMarket = new anchor.Program(lendingMarketIdl as anchor.Idl, provider);

  const mockPythProgramId = new PublicKey(
    (JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/mock_pyth.json"), "utf-8")) as any).address,
  );

  // Keeper authority: a dedicated keypair, persisted so a real keeper
  // process can reuse it later (see .env.example KEEPER_KEYPAIR_PATH).
  const keeperPath = path.join(__dirname, "../keeper-keypair.json");
  const keeper = fs.existsSync(keeperPath) ? loadKeypair(keeperPath) : Keypair.generate();
  if (!fs.existsSync(keeperPath)) fs.writeFileSync(keeperPath, JSON.stringify(Array.from(keeper.secretKey)));
  console.log(`Keeper authority: ${keeper.publicKey.toBase58()}`);

  const feedId = Array.from(crypto.createHash("sha256").update("AAPLx/USD").digest());

  console.log("\nCreating AAPLx-equivalent mint (Token-2022, ScaledUiAmount, 1.0x multiplier)...");
  const collateralMint = await createScaledUiMint(connection, payer, payer.publicKey, 6, 1.0);
  console.log(`AAPLx mint: ${collateralMint.toBase58()}`);

  console.log("Creating mock USDC mint (6 decimals, plain SPL Token)...");
  const debtMint = await createDebtMint(connection, payer, payer.publicKey, 6);
  console.log(`USDC mint: ${debtMint.toBase58()}`);

  const [regimeState] = PublicKey.findProgramAddressSync(
    [Buffer.from("regime_state"), Buffer.from(feedId)],
    regimeOracle.programId,
  );
  const [reserve] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), collateralMint.toBuffer()],
    lendingMarket.programId,
  );
  const [reserveAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("reserve_authority"), reserve.toBuffer()],
    lendingMarket.programId,
  );
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault"), reserve.toBuffer()],
    lendingMarket.programId,
  );
  const [debtVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("debt_vault"), reserve.toBuffer()],
    lendingMarket.programId,
  );

  console.log("\nInitializing regime_oracle RegimeState at $150.00...");
  const initSig = await regimeOracle.methods
    .initialize(feedId, usd(150), mockPythProgramId)
    .accounts({
      payer: payer.publicKey,
      keeperAuthority: keeper.publicKey,
      regimeState,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  signature: ${initSig}`);

  console.log("Initializing lending_market Reserve (90% LTV / 92% liq. threshold / 5% liq. bonus / 60s hold)...");
  const reserveSig = await lendingMarket.methods
    .initializeReserve(9000, 9200, 500, new BN(60))
    .accounts({
      payer: payer.publicKey,
      collateralMint,
      debtMint,
      regimeState,
      reserve,
      reserveAuthority,
      collateralVault,
      debtVault,
      collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
      debtTokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  signature: ${reserveSig}`);

  console.log("Seeding debt vault with 1,000,000 mock USDC of lending liquidity...");
  await mintTokens(connection, payer, debtMint, debtVault, payer, 1_000_000_000_000n, TOKEN_PROGRAM_ID);

  const config = {
    rpc: RPC,
    regimeOracleProgramId: regimeOracle.programId.toBase58(),
    lendingMarketProgramId: lendingMarket.programId.toBase58(),
    mockPythProgramId: mockPythProgramId.toBase58(),
    collateralMint: collateralMint.toBase58(),
    debtMint: debtMint.toBase58(),
    feedId,
    regimeState: regimeState.toBase58(),
    reserve: reserve.toBase58(),
  };
  fs.writeFileSync(path.join(__dirname, "devnet-config.json"), JSON.stringify(config, null, 2));
  console.log(`\nWrote scripts/devnet-config.json (used by \`npm run demo:devnet\`)`);

  console.log("\n=== Also paste into app/.env.local ===\n");
  console.log(`NEXT_PUBLIC_RPC_ENDPOINT=${RPC}`);
  console.log(`NEXT_PUBLIC_REGIME_ORACLE_PROGRAM_ID=${regimeOracle.programId.toBase58()}`);
  console.log(`NEXT_PUBLIC_LENDING_MARKET_PROGRAM_ID=${lendingMarket.programId.toBase58()}`);
  console.log(`NEXT_PUBLIC_MOCK_PYTH_PROGRAM_ID=${mockPythProgramId.toBase58()}`);
  console.log(`NEXT_PUBLIC_AAPLX_MINT=${collateralMint.toBase58()}`);
  console.log(`NEXT_PUBLIC_USDC_MINT=${debtMint.toBase58()}`);
  console.log(`NEXT_PUBLIC_FEED_ID=[${feedId.join(",")}]`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
