/**
 * Creates an isolated devnet market for testing the dashboard against a specific collateral setup, most
 * usefully a Token-2022 scaled-UI-amount multiplier other than 1.0 (the deployed AAPLx mint's is 1.0, which
 * hides any place the UI forgets to apply it).
 *
 *   LAB_KEYPAIR=<funded devnet key> npx ts-node --project tsconfig.json scripts/dev-market.ts \
 *       --multiplier 1.5 --price 300 --borrower-key <path to write a borrower keypair>
 *
 * It initialises its own oracle instance (open-market path, fed by mock_pyth), reserve (90% LTV, 92%
 * threshold, 5% bonus), seeds the debt vault, funds a borrower with 10 base-unit AAPLx, cranks a fresh price,
 * and prints the NEXT_PUBLIC_* values to point a local dashboard at it. Needs about 0.04 devnet SOL.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";

import { createDebtMint, createScaledUiMint, ensureAta, mintTokens, onChainUnixTimestamp } from "../tests/utils";
import regimeOracleIdl from "../target/idl/regime_oracle.json";
import lendingMarketIdl from "../target/idl/lending_market.json";
import mockPythIdl from "../target/idl/mock_pyth.json";

const usd = (d: number) => new BN(Math.round(d * 1_000_000));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function retry<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= 5 || !/fetch failed|Blockhash not found|429|timeout|ECONNRESET|socket/i.test(String((e as Error)?.message ?? e))) throw e;
      await sleep(2500 * (i + 1));
    }
  }
}
const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

async function main() {
  const multiplier = Number(arg("--multiplier", "1.5"));
  const price = Number(arg("--price", "300"));
  const borrowerKeyPath = arg("--borrower-key");
  const keyPath = (process.env.LAB_KEYPAIR ?? process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json").replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? "");
  const lab = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf-8"))));
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(lab), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const regimeOracle = new anchor.Program(regimeOracleIdl as anchor.Idl, provider);
  const lendingMarket = new anchor.Program(lendingMarketIdl as anchor.Idl, provider);
  const mockPyth = new anchor.Program(mockPythIdl as anchor.Idl, provider);

  const feedId = Array.from(Keypair.generate().publicKey.toBytes());
  const collateralMint = await retry(() => createScaledUiMint(connection, lab, lab.publicKey, 6, multiplier));
  const debtMint = await retry(() => createDebtMint(connection, lab, lab.publicKey, 6));
  const pda = (seeds: Buffer[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];
  const regimeState = pda([Buffer.from("regime_state"), Buffer.from(feedId)], regimeOracle.programId);
  const reserve = pda([Buffer.from("reserve"), collateralMint.toBuffer()], lendingMarket.programId);
  const reserveAuthority = pda([Buffer.from("reserve_authority"), reserve.toBuffer()], lendingMarket.programId);
  const collateralVault = pda([Buffer.from("collateral_vault"), reserve.toBuffer()], lendingMarket.programId);
  const debtVault = pda([Buffer.from("debt_vault"), reserve.toBuffer()], lendingMarket.programId);
  const mockPrice = pda([Buffer.from("mock_price"), Buffer.from(feedId)], mockPyth.programId);

  await retry(() =>
    regimeOracle.methods
      .initialize(feedId, usd(price), mockPyth.programId)
      .accounts({ payer: lab.publicKey, keeperAuthority: lab.publicKey, regimeState, systemProgram: SystemProgram.programId })
      .rpc(),
  );
  await retry(() =>
    lendingMarket.methods
      .initializeReserve(9000, 9200, 500, new BN(0))
      .accounts({
        payer: lab.publicKey,
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
      .rpc(),
  );
  await sleep(4000);
  await retry(() => mintTokens(connection, lab, debtMint, debtVault, lab, 1_000_000_000_000n, TOKEN_PROGRAM_ID));

  const borrower = Keypair.generate();
  if (borrowerKeyPath) fs.writeFileSync(borrowerKeyPath, JSON.stringify(Array.from(borrower.secretKey)));
  await retry(() =>
    provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({ fromPubkey: lab.publicKey, toPubkey: borrower.publicKey, lamports: 15_000_000 }))),
  );
  const borrowerAta = await retry(() => ensureAta(connection, lab, collateralMint, borrower.publicKey, TOKEN_2022_PROGRAM_ID));
  await retry(() => mintTokens(connection, lab, collateralMint, borrowerAta, lab, 10_000_000n, TOKEN_2022_PROGRAM_ID)); // 10 base-unit AAPLx

  // keep the price fresh for a while; the oracle only accepts prices up to 180s old
  const now = await retry(() => onChainUnixTimestamp(connection));
  await retry(() =>
    mockPyth.methods
      .setPrice(feedId, usd(price), usd(0.05), -6, new BN(now))
      .accounts({ payer: lab.publicKey, priceUpdate: mockPrice, systemProgram: SystemProgram.programId })
      .rpc(),
  );
  await retry(() => regimeOracle.methods.updatePrice().accounts({ cranker: lab.publicKey, regimeState, priceUpdate: mockPrice }).rpc());

  console.log(JSON.stringify({ multiplier, price, borrower: borrower.publicKey.toBase58(), feedId, collateralMint: collateralMint.toBase58(), debtMint: debtMint.toBase58(), reserve: reserve.toBase58(), regimeState: regimeState.toBase58() }));
  console.log(`NEXT_PUBLIC_AAPLX_MINT=${collateralMint.toBase58()}`);
  console.log(`NEXT_PUBLIC_USDC_MINT=${debtMint.toBase58()}`);
  console.log(`NEXT_PUBLIC_FEED_ID=${JSON.stringify(feedId)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
