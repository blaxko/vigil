/**
 * Executes ONE real liquidation on devnet and measures what the liquidator actually gets.
 *
 * Why an isolated market: the live reserve can't be put into a liquidatable state without disturbing
 * everyone using it. This script builds a separate market on devnet (its own mints, its own oracle
 * instance, its own reserve) with the live reserve's parameters: 90% max LTV, 92% liquidation
 * threshold, 5% liquidator bonus. Only the price feed differs: its oracle is fed by mock_pyth in the
 * open-market path, so the "market price" is exactly the number the oracle converges to.
 *
 * Scenario: a borrower borrows the maximum at a $373 price. The market price then falls to $333
 * (-10.7%). The oracle's Liquidation Price follows with its usual smoothing (15% of the gap per tick,
 * at most 3% per tick), so it lags the market. The script stops at the FIRST tick where the position
 * is liquidatable, runs `liquidate`, and reports the liquidator's real USDC paid vs collateral received,
 * valued at the market price the oracle was following.
 *
 *   LAB_KEYPAIR=<funded devnet key> npx ts-node --project tsconfig.json scripts/liquidation-experiment.ts
 *
 * Needs about 0.05 devnet SOL. Writes scripts/liquidation-experiment.json.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

import { createDebtMint, createScaledUiMint, ensureAta, mintTokens, onChainUnixTimestamp } from "../tests/utils";
import regimeOracleIdl from "../target/idl/regime_oracle.json";
import lendingMarketIdl from "../target/idl/lending_market.json";
import mockPythIdl from "../target/idl/mock_pyth.json";

const PRICE_SCALE = 1_000_000;
const usd = (d: number) => new BN(Math.round(d * PRICE_SCALE));
const MAX_LTV_BPS = 9000;
const LIQ_THRESHOLD_BPS = 9200;
const LIQ_BONUS_BPS = 500;

const BORROW_PRICE = 373; // market price when the position is opened
const CRASH_PRICE = 333; // market price afterwards (-10.7%)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function retry<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      if (i >= 5 || !/fetch failed|Blockhash not found|429|timeout|ECONNRESET|socket/i.test(m)) throw e;
      await sleep(2500 * (i + 1));
    }
  }
}

function loadKeypair(p: string): Keypair {
  const resolved = p.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? "");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf-8"))));
}

async function main() {
  const lab = loadKeypair(process.env.LAB_KEYPAIR ?? process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json");
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(lab), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const regimeOracle = new anchor.Program(regimeOracleIdl as anchor.Idl, provider);
  const lendingMarket = new anchor.Program(lendingMarketIdl as anchor.Idl, provider);
  const mockPyth = new anchor.Program(mockPythIdl as anchor.Idl, provider);
  const out: Record<string, unknown> = {
    network: "devnet",
    isolatedMarket: true,
    params: { MAX_LTV_BPS, LIQ_THRESHOLD_BPS, LIQ_BONUS_BPS },
    signatures: {},
  };
  const sigs = out.signatures as Record<string, string>;

  console.log("lab wallet (liquidator):", lab.publicKey.toBase58(), "SOL", (await connection.getBalance(lab.publicKey)) / 1e9);

  // --- isolated market
  const feedId = Array.from(Keypair.generate().publicKey.toBytes()); // unique feed id => its own oracle state
  const collateralMint = await retry(() => createScaledUiMint(connection, lab, lab.publicKey, 6, 1.0));
  const debtMint = await retry(() => createDebtMint(connection, lab, lab.publicKey, 6));
  const pda = (seeds: Buffer[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];
  const regimeState = pda([Buffer.from("regime_state"), Buffer.from(feedId)], regimeOracle.programId);
  const reserve = pda([Buffer.from("reserve"), collateralMint.toBuffer()], lendingMarket.programId);
  const reserveAuthority = pda([Buffer.from("reserve_authority"), reserve.toBuffer()], lendingMarket.programId);
  const collateralVault = pda([Buffer.from("collateral_vault"), reserve.toBuffer()], lendingMarket.programId);
  const debtVault = pda([Buffer.from("debt_vault"), reserve.toBuffer()], lendingMarket.programId);
  const mockPrice = pda([Buffer.from("mock_price"), Buffer.from(feedId)], mockPyth.programId);
  Object.assign(out, {
    collateralMint: collateralMint.toBase58(),
    debtMint: debtMint.toBase58(),
    reserve: reserve.toBase58(),
    regimeState: regimeState.toBase58(),
  });
  console.log("isolated market: reserve", reserve.toBase58());

  sigs.initOracle = await retry(() =>
    regimeOracle.methods
      .initialize(feedId, usd(BORROW_PRICE), mockPyth.programId)
      .accounts({ payer: lab.publicKey, keeperAuthority: lab.publicKey, regimeState, systemProgram: SystemProgram.programId })
      .rpc(),
  );
  sigs.initReserve = await retry(() =>
    lendingMarket.methods
      .initializeReserve(MAX_LTV_BPS, LIQ_THRESHOLD_BPS, LIQ_BONUS_BPS, new BN(0))
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
  await retry(() => mintTokens(connection, lab, debtMint, debtVault, lab, 10_000_000_000n, TOKEN_PROGRAM_ID)); // $10,000 USDC to lend

  const setPrice = async (price: number) => {
    const now = await retry(() => onChainUnixTimestamp(connection));
    await retry(() =>
      mockPyth.methods
        .setPrice(feedId, usd(price), usd(0.05), -6, new BN(now))
        .accounts({ payer: lab.publicKey, priceUpdate: mockPrice, systemProgram: SystemProgram.programId })
        .rpc(),
    );
  };
  const crank = async () => {
    const s = await retry(() =>
      regimeOracle.methods.updatePrice().accounts({ cranker: lab.publicKey, regimeState, priceUpdate: mockPrice }).rpc(),
    );
    const st: any = await (regimeOracle.account as any).regimeState.fetch(regimeState);
    return { sig: s, borrowLimit: Number(st.borrowLimitPrice) / PRICE_SCALE, liquidation: Number(st.liquidationPrice) / PRICE_SCALE };
  };

  // --- borrower opens a max-LTV position at BORROW_PRICE
  const borrower = Keypair.generate();
  await retry(() =>
    provider.sendAndConfirm(
      new Transaction().add(SystemProgram.transfer({ fromPubkey: lab.publicKey, toPubkey: borrower.publicKey, lamports: 10_000_000 })),
    ),
  );
  const borrowerCollateralAta = await retry(() => ensureAta(connection, lab, collateralMint, borrower.publicKey, TOKEN_2022_PROGRAM_ID));
  const borrowerDebtAta = await retry(() => ensureAta(connection, lab, debtMint, borrower.publicKey, TOKEN_PROGRAM_ID));
  await retry(() => mintTokens(connection, lab, collateralMint, borrowerCollateralAta, lab, 1_000_000n, TOKEN_2022_PROGRAM_ID)); // 1 test AAPLx
  const position = pda([Buffer.from("position"), reserve.toBuffer(), borrower.publicKey.toBuffer()], lendingMarket.programId);

  await setPrice(BORROW_PRICE);
  const atBorrow = await crank();
  sigs.deposit = await retry(() =>
    lendingMarket.methods
      .deposit(new BN(1_000_000))
      .accounts({
        owner: borrower.publicKey,
        reserve,
        position,
        collateralMint,
        ownerCollateralAta: borrowerCollateralAta,
        collateralVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([borrower])
      .rpc(),
  );
  const maxBorrowBase = Math.floor(atBorrow.borrowLimit * (MAX_LTV_BPS / 10_000) * 1_000_000) - 10_000; // just under the limit
  sigs.borrow = await retry(() =>
    lendingMarket.methods
      .borrow(new BN(maxBorrowBase))
      .accounts({
        owner: borrower.publicKey,
        reserve,
        position,
        regimeState,
        collateralMint,
        debtMint,
        ownerDebtAta: borrowerDebtAta,
        debtVault,
        reserveAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([borrower])
      .rpc(),
  );
  const debt = maxBorrowBase / 1e6;
  console.log(`borrower: 1 AAPLx collateral, borrowed $${debt.toFixed(2)} (borrow-limit price $${atBorrow.borrowLimit.toFixed(2)})`);
  const triggerLiquidationPrice = debt / (LIQ_THRESHOLD_BPS / 10_000); // position liquidatable once LP <= this
  console.log(`position becomes liquidatable once the Liquidation Price is at or below $${triggerLiquidationPrice.toFixed(2)}`);

  // --- market falls; step the oracle until the position is first liquidatable
  const ticks: { tick: number; liquidationPrice: number; borrowLimit: number; liquidatable: boolean }[] = [];
  let state = atBorrow;
  for (let i = 1; i <= 12; i++) {
    await setPrice(CRASH_PRICE);
    state = await crank();
    const liquidatable = state.liquidation <= triggerLiquidationPrice;
    ticks.push({ tick: i, liquidationPrice: state.liquidation, borrowLimit: state.borrowLimit, liquidatable });
    console.log(`  tick ${i}: market $${CRASH_PRICE}, Liquidation Price $${state.liquidation.toFixed(2)} -> ${liquidatable ? "LIQUIDATABLE" : "not yet"}`);
    if (liquidatable) break;
  }
  out.ticks = ticks;
  if (!ticks[ticks.length - 1].liquidatable) throw new Error("position never became liquidatable within 12 ticks");

  // --- liquidator = lab wallet. Fund it with the mock USDC it needs, then measure exact balances around the call.
  const liquidatorDebtAta = await retry(() => ensureAta(connection, lab, debtMint, lab.publicKey, TOKEN_PROGRAM_ID));
  const liquidatorCollateralAta = await retry(() => ensureAta(connection, lab, collateralMint, lab.publicKey, TOKEN_2022_PROGRAM_ID));
  await retry(() => mintTokens(connection, lab, debtMint, liquidatorDebtAta, lab, 1_000_000_000n, TOKEN_PROGRAM_ID)); // $1,000
  await sleep(3000);
  const bal = async (ata: PublicKey) => BigInt((await retry(() => connection.getTokenAccountBalance(ata))).value.amount);
  const usdcBefore = await bal(liquidatorDebtAta);
  const aaplBefore = await bal(liquidatorCollateralAta);
  const posBefore: any = await (lendingMarket.account as any).position.fetch(position);

  // Liquidate at the first liquidatable tick, without cranking again: the last update was seconds ago and the
  // lending program accepts oracle prices up to 180s old.
  const atLiquidation = state;
  sigs.liquidate = await retry(() =>
    lendingMarket.methods
      .liquidate()
      .accounts({
        liquidator: lab.publicKey,
        reserve,
        position,
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
      .rpc(),
  );
  await sleep(3000);
  const usdcAfter = await bal(liquidatorDebtAta);
  const aaplAfter = await bal(liquidatorCollateralAta);

  const paid = Number(usdcBefore - usdcAfter) / 1e6; // USDC the liquidator paid to clear the debt
  const received = Number(aaplAfter - aaplBefore) / 1e6; // AAPLx (multiplier 1.0) the liquidator received
  const receivedValue = received * CRASH_PRICE; // valued at the market price the oracle follows
  const pnl = receivedValue - paid;
  Object.assign(out, {
    borrowerDebtUsd: debt,
    positionCollateralBeforeAapl: Number(posBefore.collateralBase) / 1e6,
    marketPriceUsd: CRASH_PRICE,
    liquidationPriceAtLiquidationUsd: atLiquidation.liquidation,
    liquidatorPaidUsdc: paid,
    liquidatorReceivedAaplx: received,
    liquidatorReceivedValueAtMarketUsd: receivedValue,
    liquidatorProfitUsd: pnl,
    liquidatorProfitPct: (pnl / paid) * 100,
    breakEvenLiquidationPriceUsd: CRASH_PRICE / (1 - LIQ_BONUS_BPS / 10_000), // LP at or below this makes the bonus cover the lag
    explorer: `https://explorer.solana.com/tx/${sigs.liquidate}?cluster=devnet`,
  });
  fs.writeFileSync(path.join(__dirname, "liquidation-experiment.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
