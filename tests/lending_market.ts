import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import {
  airdrop,
  createScaledUiMint,
  createDebtMint,
  ensureAta,
  mintTokens,
  onChainUnixTimestamp,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./utils";

import regimeOracleIdl from "../target/idl/regime_oracle.json";
import lendingMarketIdl from "../target/idl/lending_market.json";
import mockPythIdl from "../target/idl/mock_pyth.json";

// Micro-USD fixed point, matching regime_oracle::math::PRICE_SCALE (1e6).
const PRICE_SCALE = 1_000_000;
const usd = (dollars: number) => new BN(Math.round(dollars * PRICE_SCALE));

describe("Vigil: full lending lifecycle against real on-chain instructions", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const regimeOracle = new anchor.Program(regimeOracleIdl as anchor.Idl, provider);
  const lendingMarket = new anchor.Program(lendingMarketIdl as anchor.Idl, provider);
  const mockPyth = new anchor.Program(mockPythIdl as anchor.Idl, provider);

  const keeper = Keypair.generate();
  const borrower = Keypair.generate();
  const liquidator = Keypair.generate();

  const feedId = Array.from(Buffer.alloc(32, 7)); // arbitrary fixed test feed id
  const COLLATERAL_DECIMALS = 6;
  const COLLATERAL_MULTIPLIER = 1.5; // exercises the scaled-ui-amount conversion non-trivially
  const MAX_LTV_BPS = 9000;
  const LIQUIDATION_THRESHOLD_BPS = 9200;
  const LIQUIDATION_BONUS_BPS = 500;

  let collateralMint: PublicKey;
  let debtMint: PublicKey;
  let regimeState: PublicKey;
  let reserve: PublicKey;
  let reserveAuthority: PublicKey;
  let collateralVault: PublicKey;
  let debtVault: PublicKey;
  let mockPriceAccount: PublicKey;

  before(async () => {
    await Promise.all([
      airdrop(connection, payer.publicKey, 5),
      airdrop(connection, keeper.publicKey, 2),
      airdrop(connection, borrower.publicKey, 2),
      airdrop(connection, liquidator.publicKey, 2),
    ]);

    collateralMint = await createScaledUiMint(connection, payer, payer.publicKey, COLLATERAL_DECIMALS, COLLATERAL_MULTIPLIER);
    debtMint = await createDebtMint(connection, payer, payer.publicKey, 6);

    [regimeState] = PublicKey.findProgramAddressSync(
      [Buffer.from("regime_state"), Buffer.from(feedId)],
      regimeOracle.programId,
    );
    [reserve] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), collateralMint.toBuffer()],
      lendingMarket.programId,
    );
    [reserveAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve_authority"), reserve.toBuffer()],
      lendingMarket.programId,
    );
    [collateralVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("collateral_vault"), reserve.toBuffer()],
      lendingMarket.programId,
    );
    [debtVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("debt_vault"), reserve.toBuffer()],
      lendingMarket.programId,
    );
    [mockPriceAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("mock_price"), Buffer.from(feedId)],
      mockPyth.programId,
    );
  });

  it("initializes the regime oracle at $150.00, pointed at the mock Pyth writer", async () => {
    await regimeOracle.methods
      .initialize(feedId, usd(150), mockPyth.programId)
      .accounts({
        payer: payer.publicKey,
        keeperAuthority: keeper.publicKey,
        regimeState,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const state = await (regimeOracle.account as any).regimeState.fetch(regimeState);
    expect(state.isOpen).to.equal(true);
    expect(state.borrowLimitPrice.toString()).to.equal(usd(150).toString());
    expect(state.pythReceiverProgram.toString()).to.equal(mockPyth.programId.toString());
  });

  it("initializes the isolated AAPLx-equivalent reserve", async () => {
    await lendingMarket.methods
      .initializeReserve(MAX_LTV_BPS, LIQUIDATION_THRESHOLD_BPS, LIQUIDATION_BONUS_BPS, new BN(0))
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

    const reserveAccount = await (lendingMarket.account as any).reserve.fetch(reserve);
    expect(reserveAccount.maxLtvBps).to.equal(MAX_LTV_BPS);

    // Seed the debt vault with USDC liquidity to lend out (devnet mock
    // liquidity, standing in for real lender deposits -- see brief scope).
    await mintTokens(connection, payer, debtMint, debtVault, payer, 1_000_000_000_000n, TOKEN_PROGRAM_ID);
  });

  let borrowerCollateralAta: PublicKey;
  let borrowerDebtAta: PublicKey;
  let depositTxSig: string;

  it("a wallet connects, deposits collateral, and it shows up in an on-chain Position account", async () => {
    borrowerCollateralAta = await ensureAta(connection, payer, collateralMint, borrower.publicKey, TOKEN_2022_PROGRAM_ID);
    borrowerDebtAta = await ensureAta(connection, payer, debtMint, borrower.publicKey, TOKEN_PROGRAM_ID);

    // 10 whole "shares" in base units (pre-multiplier): 10 * 10^6.
    const depositBase = new BN(10).mul(new BN(10 ** COLLATERAL_DECIMALS));
    await mintTokens(connection, payer, collateralMint, borrowerCollateralAta, payer, BigInt(depositBase.toString()), TOKEN_2022_PROGRAM_ID);

    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), reserve.toBuffer(), borrower.publicKey.toBuffer()],
      lendingMarket.programId,
    );

    depositTxSig = await lendingMarket.methods
      .deposit(depositBase)
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
      .rpc();

    const positionAccount = await (lendingMarket.account as any).position.fetch(position);
    expect(positionAccount.collateralBase.toString()).to.equal(depositBase.toString());
    expect(positionAccount.owner.toString()).to.equal(borrower.publicKey.toString());
    console.log(`    deposit signature: ${depositTxSig}`);
  });

  let borrowTxSig: string;

  it("cranks a live Pyth-style price update, then borrows up to the Borrow-Limit-Price-derived limit", async () => {
    const now = await onChainUnixTimestamp(connection);
    await mockPyth.methods
      .setPrice(feedId, usd(150), usd(0.05), -6, new BN(now))
      .accounts({ payer: payer.publicKey, priceUpdate: mockPriceAccount, systemProgram: SystemProgram.programId })
      .rpc();

    await regimeOracle.methods
      .updatePrice()
      .accounts({ cranker: payer.publicKey, regimeState, priceUpdate: mockPriceAccount })
      .rpc();

    const state = await (regimeOracle.account as any).regimeState.fetch(regimeState);
    // Collateral value: 10 shares * 1.5x multiplier = 15 UI shares * ~$150 = ~$2250.
    // 90% LTV of that is ~$2025; borrow comfortably under to leave room to
    // observe the crash-to-liquidation flow below.
    const borrowAmount = new BN(1_800).mul(new BN(10 ** 6)); // $1,800 USDC

    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), reserve.toBuffer(), borrower.publicKey.toBuffer()],
      lendingMarket.programId,
    );

    borrowTxSig = await lendingMarket.methods
      .borrow(borrowAmount)
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
      .rpc();

    const positionAccount = await (lendingMarket.account as any).position.fetch(position);
    expect(positionAccount.debtAmount.toString()).to.equal(borrowAmount.toString());
    const debtBalance = await connection.getTokenAccountBalance(borrowerDebtAta);
    expect(debtBalance.value.amount).to.equal(borrowAmount.toString());
    console.log(`    borrow signature: ${borrowTxSig}`);
    console.log(`    borrow-limit price after crank: $${(Number(state.borrowLimitPrice) / PRICE_SCALE).toFixed(2)}`);
  });

  it("rejects borrow when the wrong token_program is passed for the debt mint", async () => {
    // debt_mint/debt_vault are plain SPL Token accounts; passing the
    // Token-2022 program instead must fail on-chain (IncorrectProgramId),
    // not silently succeed against the wrong CPI target. This is the same
    // bug class that was already found and fixed in `liquidate` and
    // `initialize_reserve` (both move two different token-program-owned
    // mints in one call) -- this test proves `borrow`'s single
    // token_program field is genuinely bound to the debt program, not
    // just correct by inspection.
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), reserve.toBuffer(), borrower.publicKey.toBuffer()],
      lendingMarket.programId,
    );
    const positionBefore = await (lendingMarket.account as any).position.fetch(position);

    const smallAmount = new BN(10).mul(new BN(10 ** 6)); // well within remaining borrow room
    let threw = false;
    try {
      await lendingMarket.methods
        .borrow(smallAmount)
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
          tokenProgram: TOKEN_2022_PROGRAM_ID, // wrong: debt_vault/debt_mint are plain SPL Token
        })
        .signers([borrower])
        .rpc();
    } catch (err) {
      threw = true;
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).to.match(/IncorrectProgramId|incorrect program id|custom program error/i);
    }
    expect(threw, "borrow with the wrong token_program should have been rejected on-chain").to.equal(true);

    // Confirm the rejected transaction had no effect: debt is unchanged.
    const positionAfter = await (lendingMarket.account as any).position.fetch(position);
    expect(positionAfter.debtAmount.toString()).to.equal(positionBefore.debtAmount.toString());
  });

  it("a real price crash drives the position to liquidation-eligible, and a second wallet liquidates it", async () => {
    // Simulate a genuine live-market price crash (not a closure -- Vigil's
    // per-tick clamp is what's under test here): repeatedly crank a much
    // lower live Pyth print. Each update_price call is clamped to a 3%
    // move, so this takes a number of real ticks to erode the Liquidation
    // Price down to where debt/collateral crosses the 92% threshold.
    let lastLiquidationPrice = new BN(0);
    for (let i = 0; i < 40; i++) {
      const now = await onChainUnixTimestamp(connection);
      await mockPyth.methods
        .setPrice(feedId, usd(40), usd(0.02), -6, new BN(now))
        .accounts({ payer: payer.publicKey, priceUpdate: mockPriceAccount, systemProgram: SystemProgram.programId })
        .rpc();

      await regimeOracle.methods
        .updatePrice()
        .accounts({ cranker: payer.publicKey, regimeState, priceUpdate: mockPriceAccount })
        .rpc();

      const state = await (regimeOracle.account as any).regimeState.fetch(regimeState);
      lastLiquidationPrice = state.liquidationPrice;

      // Liquidatable when debt >= collateral_ui_value(liq_price) * 92%.
      // collateral_ui = 10 base * 1.5 multiplier = 15 (whole shares).
      const collateralValue = lastLiquidationPrice.muln(15).divn(1); // micro-USD * 15
      const thresholdValue = collateralValue.muln(LIQUIDATION_THRESHOLD_BPS).divn(10_000);
      const debtMicroUsd = new BN(1_800).mul(new BN(PRICE_SCALE));
      if (debtMicroUsd.gte(thresholdValue)) break;
    }
    console.log(`    liquidation price after crash ticks: $${(Number(lastLiquidationPrice) / PRICE_SCALE).toFixed(4)}`);

    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), reserve.toBuffer(), borrower.publicKey.toBuffer()],
      lendingMarket.programId,
    );
    const positionBefore = await (lendingMarket.account as any).position.fetch(position);
    expect(positionBefore.debtAmount.gtn(0)).to.equal(true);

    const liquidatorDebtAta = await ensureAta(connection, payer, debtMint, liquidator.publicKey, TOKEN_PROGRAM_ID);
    const liquidatorCollateralAta = await ensureAta(connection, payer, collateralMint, liquidator.publicKey, TOKEN_2022_PROGRAM_ID);
    // Fund the liquidator with enough USDC to fully repay the position's debt.
    await mintTokens(connection, payer, debtMint, liquidatorDebtAta, payer, 2_000_000_000n, TOKEN_PROGRAM_ID);

    const liquidateTxSig = await lendingMarket.methods
      .liquidate()
      .accounts({
        liquidator: liquidator.publicKey,
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
      .signers([liquidator])
      .rpc();

    const positionAfter = await (lendingMarket.account as any).position.fetch(position);
    expect(positionAfter.debtAmount.toNumber()).to.equal(0);
    expect(positionAfter.collateralBase.lt(positionBefore.collateralBase)).to.equal(true);

    const liquidatorCollateralBalance = await connection.getTokenAccountBalance(liquidatorCollateralAta);
    expect(Number(liquidatorCollateralBalance.value.amount)).to.be.greaterThan(0);

    console.log(`    liquidate signature: ${liquidateTxSig}`);
    console.log(`    collateral seized (base units): ${positionBefore.collateralBase.sub(positionAfter.collateralBase).toString()}`);
  });
});

describe("Vigil: repay fully closes a position and returns collateral", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const regimeOracle = new anchor.Program(regimeOracleIdl as anchor.Idl, provider);
  const lendingMarket = new anchor.Program(lendingMarketIdl as anchor.Idl, provider);
  const mockPyth = new anchor.Program(mockPythIdl as anchor.Idl, provider);

  const keeper = Keypair.generate();
  const user = Keypair.generate();
  const feedId = Array.from(Buffer.alloc(32, 9));
  const COLLATERAL_DECIMALS = 6;

  let collateralMint: PublicKey;
  let debtMint: PublicKey;
  let regimeState: PublicKey;
  let reserve: PublicKey;
  let reserveAuthority: PublicKey;
  let collateralVault: PublicKey;
  let debtVault: PublicKey;
  let mockPriceAccount: PublicKey;
  let position: PublicKey;
  let userCollateralAta: PublicKey;
  let userDebtAta: PublicKey;

  before(async () => {
    await Promise.all([
      airdrop(connection, payer.publicKey, 3),
      airdrop(connection, keeper.publicKey, 1),
      airdrop(connection, user.publicKey, 2),
    ]);

    collateralMint = await createScaledUiMint(connection, payer, payer.publicKey, COLLATERAL_DECIMALS, 1.0);
    debtMint = await createDebtMint(connection, payer, payer.publicKey, 6);

    [regimeState] = PublicKey.findProgramAddressSync([Buffer.from("regime_state"), Buffer.from(feedId)], regimeOracle.programId);
    [reserve] = PublicKey.findProgramAddressSync([Buffer.from("reserve"), collateralMint.toBuffer()], lendingMarket.programId);
    [reserveAuthority] = PublicKey.findProgramAddressSync([Buffer.from("reserve_authority"), reserve.toBuffer()], lendingMarket.programId);
    [collateralVault] = PublicKey.findProgramAddressSync([Buffer.from("collateral_vault"), reserve.toBuffer()], lendingMarket.programId);
    [debtVault] = PublicKey.findProgramAddressSync([Buffer.from("debt_vault"), reserve.toBuffer()], lendingMarket.programId);
    [mockPriceAccount] = PublicKey.findProgramAddressSync([Buffer.from("mock_price"), Buffer.from(feedId)], mockPyth.programId);
    [position] = PublicKey.findProgramAddressSync([Buffer.from("position"), reserve.toBuffer(), user.publicKey.toBuffer()], lendingMarket.programId);

    await regimeOracle.methods
      .initialize(feedId, usd(100), mockPyth.programId)
      .accounts({ payer: payer.publicKey, keeperAuthority: keeper.publicKey, regimeState, systemProgram: SystemProgram.programId })
      .rpc();

    await lendingMarket.methods
      .initializeReserve(8000, 8500, 500, new BN(0))
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
    await mintTokens(connection, payer, debtMint, debtVault, payer, 1_000_000_000_000n, TOKEN_PROGRAM_ID);

    userCollateralAta = await ensureAta(connection, payer, collateralMint, user.publicKey, TOKEN_2022_PROGRAM_ID);
    userDebtAta = await ensureAta(connection, payer, debtMint, user.publicKey, TOKEN_PROGRAM_ID);
    const depositBase = new BN(5).mul(new BN(10 ** COLLATERAL_DECIMALS));
    await mintTokens(connection, payer, collateralMint, userCollateralAta, payer, BigInt(depositBase.toString()), TOKEN_2022_PROGRAM_ID);

    await lendingMarket.methods
      .deposit(depositBase)
      .accounts({
        owner: user.publicKey,
        reserve,
        position,
        collateralMint,
        ownerCollateralAta: userCollateralAta,
        collateralVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const now = await onChainUnixTimestamp(connection);
    await mockPyth.methods
      .setPrice(feedId, usd(100), usd(0.05), -6, new BN(now))
      .accounts({ payer: payer.publicKey, priceUpdate: mockPriceAccount, systemProgram: SystemProgram.programId })
      .rpc();
    await regimeOracle.methods
      .updatePrice()
      .accounts({ cranker: payer.publicKey, regimeState, priceUpdate: mockPriceAccount })
      .rpc();

    const borrowAmount = new BN(200).mul(new BN(10 ** 6)); // small, safe borrow
    await lendingMarket.methods
      .borrow(borrowAmount)
      .accounts({
        owner: user.publicKey,
        reserve,
        position,
        regimeState,
        collateralMint,
        debtMint,
        ownerDebtAta: userDebtAta,
        debtVault,
        reserveAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();
  });

  it("repay fully closes the position, and withdraw returns all remaining collateral", async () => {
    const positionBeforeRepay = await (lendingMarket.account as any).position.fetch(position);
    expect(positionBeforeRepay.debtAmount.gtn(0)).to.equal(true);

    const repayTxSig = await lendingMarket.methods
      .repay(positionBeforeRepay.debtAmount)
      .accounts({
        owner: user.publicKey,
        reserve,
        position,
        debtMint,
        ownerDebtAta: userDebtAta,
        debtVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const positionAfterRepay = await (lendingMarket.account as any).position.fetch(position);
    expect(positionAfterRepay.debtAmount.toNumber()).to.equal(0);
    console.log(`    repay signature: ${repayTxSig}`);

    const withdrawTxSig = await lendingMarket.methods
      .withdraw(positionAfterRepay.collateralBase)
      .accounts({
        owner: user.publicKey,
        reserve,
        position,
        regimeState,
        collateralMint,
        ownerCollateralAta: userCollateralAta,
        collateralVault,
        reserveAuthority,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const positionAfterWithdraw = await (lendingMarket.account as any).position.fetch(position);
    expect(positionAfterWithdraw.collateralBase.toNumber()).to.equal(0);
    console.log(`    withdraw signature: ${withdrawTxSig}`);
  });
});
