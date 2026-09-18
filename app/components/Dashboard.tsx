"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { AAPLX_MINT, COLLATERAL_DECIMALS, FEED_ID, PRICE_SCALE, USDC_MINT } from "@/lib/constants";
import { getLendingMarketProgram, getProvider, getReadOnlyProvider, getRegimeOracleProgram } from "@/lib/anchor";
import { collateralVaultPda, debtVaultPda, positionPda, regimeStatePda, reservePda, reserveAuthorityPda } from "@/lib/pda";

type RegimeState = {
  isOpen: boolean;
  borrowLimitPrice: BN;
  liquidationPrice: BN;
  lastUpdateTs: BN;
};

type Position = {
  collateralBase: BN;
  debtAmount: BN;
};

type Reserve = {
  maxLtvBps: number;
};

const fmtUsd = (micro: BN) => `$${(Number(micro) / PRICE_SCALE).toFixed(2)}`;

/** Turns a thrown Anchor/web3.js error into a message a user can act on,
 * instead of a raw stack trace or an indefinite spinner. */
function describeTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/User rejected/i.test(msg)) return "Transaction rejected in wallet.";
  if (/insufficient/i.test(msg) && /lamports/i.test(msg)) return "Insufficient SOL for transaction fees.";
  if (/0x1\b/.test(msg) || /insufficient funds/i.test(msg)) return "Insufficient token balance.";
  if (/StalePythPrice|StaleOraclePrices/.test(msg)) return "Price is stale -- wait for the next crank and try again.";
  if (/BorrowLimitExceeded/.test(msg)) return "Amount exceeds your current borrow limit.";
  if (/WithdrawalExceedsLimit/.test(msg)) return "Withdrawal would leave the position under-collateralized.";
  if (/PositionHoldTimeActive/.test(msg)) return "Position is still within its minimum hold time after the last borrow.";
  if (/RepayExceedsDebt/.test(msg)) return "Repay amount exceeds outstanding debt.";
  if (/Simulation failed/i.test(msg)) return `Transaction simulation failed: ${msg.split("\n")[0]}`;
  return msg;
}

export function Dashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [regimeState, setRegimeState] = useState<RegimeState | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [reserve, setReserve] = useState<Reserve | null>(null);
  const [collateralBalance, setCollateralBalance] = useState<bigint>(BigInt(0));

  const [depositAmount, setDepositAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const configured = AAPLX_MINT && USDC_MINT && FEED_ID;

  const refresh = useCallback(async () => {
    if (!configured) return;

    const feedId = FEED_ID!;
    const regimeStateAddr = regimeStatePda(feedId);
    const reserveAddr = reservePda(AAPLX_MINT!);
    const readOnlyProvider = getReadOnlyProvider(connection);
    const regimeProgram = getRegimeOracleProgram(readOnlyProvider);
    const lendingProgram = getLendingMarketProgram(readOnlyProvider);

    try {
      const regimeAccountInfo = await connection.getAccountInfo(regimeStateAddr);
      if (regimeAccountInfo) {
        // Anchor's Program constructor normalizes IDL account names to
        // camelCase internally (RegimeState -> regimeState), even though
        // the IDL file and the Rust struct itself use PascalCase -- the
        // coder's .decode() must be called with that normalized name or
        // it throws "Account not found" despite the account genuinely
        // existing and the discriminator matching.
        const decoded = regimeProgram.coder.accounts.decode("regimeState", regimeAccountInfo.data);
        setRegimeState(decoded as RegimeState);
      }
      const reserveAccountInfo = await connection.getAccountInfo(reserveAddr);
      if (reserveAccountInfo) {
        const decoded = lendingProgram.coder.accounts.decode("reserve", reserveAccountInfo.data);
        setReserve(decoded as Reserve);
      }

      if (wallet.publicKey) {
        const posAddr = positionPda(reserveAddr, wallet.publicKey);
        const posInfo = await connection.getAccountInfo(posAddr);
        if (posInfo) {
          const decoded = lendingProgram.coder.accounts.decode("position", posInfo.data);
          setPosition(decoded as Position);
        } else {
          setPosition(null);
        }

        const ata = getAssociatedTokenAddressSync(AAPLX_MINT!, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
        const bal = await connection.getTokenAccountBalance(ata).catch(() => null);
        setCollateralBalance(bal ? BigInt(bal.value.amount) : BigInt(0));
      }
      setReadError(null);
    } catch (e) {
      // Read-side failures shouldn't blank the whole dashboard silently --
      // surface them on screen (not just console.error, which is what let
      // a RegimeState decode bug hide behind an indefinite "Loading..."
      // instead of a visible error), but don't block the UI from
      // rendering whatever state it already has.
      const msg = e instanceof Error ? e.message : String(e);
      console.error("dashboard refresh failed", e);
      setReadError(msg);
    }
  }, [connection, wallet, configured]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const runTx = async (label: string, fn: () => Promise<string>) => {
    setError(null);
    setLastSig(null);
    setPending(label);
    try {
      const sig = await fn();
      setLastSig(sig);
      await refresh();
    } catch (e) {
      setError(describeTxError(e));
    } finally {
      setPending(null);
    }
  };

  const handleDeposit = () =>
    runTx("Depositing collateral...", async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first.");
      const amount = Number(depositAmount);
      if (!amount || amount <= 0) throw new Error("Enter a positive deposit amount.");

      const provider = getProvider(connection, wallet);
      const program = getLendingMarketProgram(provider);
      const reserveAddr = reservePda(AAPLX_MINT!);
      const position = positionPda(reserveAddr, wallet.publicKey);
      const collateralVault = collateralVaultPda(reserveAddr);
      const ata = getAssociatedTokenAddressSync(AAPLX_MINT!, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const amountBase = new BN(Math.round(amount * 10 ** COLLATERAL_DECIMALS));

      return program.methods
        .deposit(amountBase)
        .accounts({
          owner: wallet.publicKey,
          reserve: reserveAddr,
          position,
          collateralMint: AAPLX_MINT!,
          ownerCollateralAta: ata,
          collateralVault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

  const handleBorrow = () =>
    runTx("Borrowing USDC...", async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first.");
      const amount = Number(borrowAmount);
      if (!amount || amount <= 0) throw new Error("Enter a positive borrow amount.");

      const provider = getProvider(connection, wallet);
      const program = getLendingMarketProgram(provider);
      const reserveAddr = reservePda(AAPLX_MINT!);
      const position = positionPda(reserveAddr, wallet.publicKey);
      const debtVault = debtVaultPda(reserveAddr);
      const reserveAuthority = reserveAuthorityPda(reserveAddr);
      const ownerDebtAta = getAssociatedTokenAddressSync(USDC_MINT!, wallet.publicKey, false, TOKEN_PROGRAM_ID);
      const amountBase = new BN(Math.round(amount * 10 ** 6));

      return program.methods
        .borrow(amountBase)
        .accounts({
          owner: wallet.publicKey,
          reserve: reserveAddr,
          position,
          regimeState: regimeStatePda(FEED_ID!),
          collateralMint: AAPLX_MINT!,
          debtMint: USDC_MINT!,
          ownerDebtAta,
          debtVault,
          reserveAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    });

  const handleRepay = () =>
    runTx("Repaying...", async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first.");
      const amount = Number(repayAmount);
      if (!amount || amount <= 0) throw new Error("Enter a positive repay amount.");

      const provider = getProvider(connection, wallet);
      const program = getLendingMarketProgram(provider);
      const reserveAddr = reservePda(AAPLX_MINT!);
      const position = positionPda(reserveAddr, wallet.publicKey);
      const debtVault = debtVaultPda(reserveAddr);
      const ownerDebtAta = getAssociatedTokenAddressSync(USDC_MINT!, wallet.publicKey, false, TOKEN_PROGRAM_ID);
      const amountBase = new BN(Math.round(amount * 10 ** 6));

      return program.methods
        .repay(amountBase)
        .accounts({
          owner: wallet.publicKey,
          reserve: reserveAddr,
          position,
          debtMint: USDC_MINT!,
          ownerDebtAta,
          debtVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    });

  const maxBorrowable =
    regimeState && position && reserve
      ? (Number(position.collateralBase) / 10 ** COLLATERAL_DECIMALS) * (Number(regimeState.borrowLimitPrice) / PRICE_SCALE) * (reserve.maxLtvBps / 10_000)
      : null;

  return (
    <div className="page">
      <div className="header">
        <div className="title">Vigil</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/replay" style={{ color: "#8a90a2", fontSize: 13 }}>
            Weekend Replay &rarr;
          </a>
          <WalletMultiButton />
        </div>
      </div>

      {!configured && (
        <div className="panel">
          <div className="error">
            No devnet deployment configured yet. Set NEXT_PUBLIC_AAPLX_MINT, NEXT_PUBLIC_USDC_MINT, and
            NEXT_PUBLIC_FEED_ID (see .env.example) after running the devnet seed script.
          </div>
        </div>
      )}

      {configured && (
        <>
          <div className="panel" style={{ borderColor: "#e0a929" }}>
            <div className="section-title" style={{ color: "#e0a929" }}>
              Branch B — Demo Mode
            </div>
            <p style={{ color: "#8a90a2", fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
              This build has no continuously-running live Hermes keeper verifying real NYSE hours in
              real time (that off-chain keeper process is separate infrastructure from what&apos;s
              built here). The regime flag below reflects on-chain state, not a live market-hours
              check performed at this instant. Every deposit/borrow/repay/withdraw transaction below
              is still real and unscripted against the deployed devnet program &mdash; only the
              open/closed input is demo-controlled rather than read from a live keeper.
            </p>
          </div>

          <div className="panel">
            <div className="section-title">Market</div>
            <div className="row">
              <span className="label">Regime</span>
              <span className={`badge ${regimeState?.isOpen ? "open" : "closed"}`}>
                {regimeState ? (regimeState.isOpen ? "Open" : "Closed — Converging") : "Loading..."}
              </span>
            </div>
            <div className="row">
              <span className="label">Borrow-Limit Price</span>
              <span className="value">{regimeState ? fmtUsd(regimeState.borrowLimitPrice) : "—"}</span>
            </div>
            <div className="row">
              <span className="label">Liquidation Price</span>
              <span className="value">{regimeState ? fmtUsd(regimeState.liquidationPrice) : "—"}</span>
            </div>
            {readError && <div className="error">Failed to load on-chain state: {readError}</div>}
          </div>

          <div className="panel">
            <div className="section-title">Your Position</div>
            <div className="row">
              <span className="label">Wallet AAPLx balance</span>
              <span className="value">{(Number(collateralBalance) / 10 ** COLLATERAL_DECIMALS).toFixed(4)}</span>
            </div>
            <div className="row">
              <span className="label">Deposited collateral (base units)</span>
              <span className="value">{position ? position.collateralBase.toString() : "0"}</span>
            </div>
            <div className="row">
              <span className="label">Outstanding debt</span>
              <span className="value">{position ? `$${(Number(position.debtAmount) / 10 ** 6).toFixed(2)}` : "$0.00"}</span>
            </div>
            <div className="row">
              <span className="label">Max borrowable (est.)</span>
              <span className="value">{maxBorrowable !== null ? `$${maxBorrowable.toFixed(2)}` : "—"}</span>
            </div>
          </div>

          <div className="panel">
            <div className="section-title">Deposit Collateral</div>
            <div className="form-row">
              <input type="number" placeholder="AAPLx amount" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
              <button disabled={!wallet.connected || !!pending} onClick={handleDeposit}>
                Deposit
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="section-title">Borrow USDC</div>
            <div className="form-row">
              <input type="number" placeholder="USDC amount" value={borrowAmount} onChange={(e) => setBorrowAmount(e.target.value)} />
              <button disabled={!wallet.connected || !!pending} onClick={handleBorrow}>
                Borrow
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="section-title">Repay</div>
            <div className="form-row">
              <input type="number" placeholder="USDC amount" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} />
              <button disabled={!wallet.connected || !!pending} onClick={handleRepay}>
                Repay
              </button>
            </div>
          </div>

          {pending && <div className="pending">{pending}</div>}
          {error && <div className="error">{error}</div>}
          {lastSig && (
            <div className="success">
              Confirmed: <a href={`https://explorer.solana.com/tx/${lastSig}?cluster=devnet`} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{lastSig}</a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
