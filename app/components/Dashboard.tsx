"use client";

import React, { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { AAPLX_MINT, COLLATERAL_DECIMALS, FEED_ID, PRICE_SCALE, USDC_MINT } from "@/lib/constants";
import { getLendingMarketProgram, getProvider } from "@/lib/anchor";
import { collateralVaultPda, debtVaultPda, positionPda, regimeStatePda, reservePda, reserveAuthorityPda } from "@/lib/pda";
import { useVigilState } from "@/lib/useVigilState";
import { PythMarketRow } from "@/components/PythMarketRow";

const fmtUsd = (micro: BN) => `$${(Number(micro) / PRICE_SCALE).toFixed(2)}`;

/** Turns a thrown Anchor/web3.js error into a message a user can act on,
 * instead of a raw stack trace or an indefinite spinner. */
function describeTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/User rejected/i.test(msg)) return "Transaction rejected in wallet.";
  if (/insufficient/i.test(msg) && /lamports/i.test(msg)) return "Insufficient SOL for transaction fees.";
  if (/0x1\b/.test(msg) || /insufficient funds/i.test(msg)) return "Insufficient token balance.";
  if (/StalePythPrice|StaleOraclePrices/.test(msg))
    return "Demo mode: the automatic oracle refresh did not run, so the on-chain price is stale. It only works while the regime is closed, and it re-posts a stored replay reference price, not a live one. Deposits and repayments are unaffected.";
  if (/BorrowLimitExceeded/.test(msg)) return "Amount exceeds your current borrow limit.";
  if (/WithdrawalExceedsLimit/.test(msg)) return "Withdrawal would leave the position under-collateralized.";
  if (/PositionHoldTimeActive/.test(msg)) return "Position is still within its minimum hold time after the last borrow.";
  if (/RepayExceedsDebt/.test(msg)) return "Repay amount exceeds outstanding debt.";
  if (/Simulation failed/i.test(msg)) return `Transaction simulation failed: ${msg.split("\n")[0]}`;
  return msg;
}

/** Demo mode: asks the server to refresh the oracle before Borrow, because
 * this build has no continuously-running keeper and the lending program
 * rejects prices older than 180 s. The route re-posts the DEX reference price
 * already stored on-chain (Sept 11-14 replay data) -- it is NOT a live price --
 * and does nothing while the on-chain regime is open. Best effort: never
 * throws, so Borrow still runs and surfaces a stale-oracle error if needed. */
async function refreshDemoOracle(): Promise<void> {
  try {
    await fetch("/api/refresh-oracle", { method: "POST" });
  } catch {
    // fall through -- describeTxError explains a stale oracle if Borrow fails
  }
}

export function Dashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { configured, regimeState, position, reserve, collateralBalance, readError, refresh } = useVigilState();

  const [depositAmount, setDepositAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);

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

  const handleFaucet = () =>
    runTx("Minting test AAPLx...", async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first.");
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: wallet.publicKey.toBase58() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Faucet request failed.");
      return body.signature as string;
    });

  const handleBorrow = () =>
    runTx("Borrowing USDC...", async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first.");
      const amount = Number(borrowAmount);
      if (!amount || amount <= 0) throw new Error("Enter a positive borrow amount.");

      setPending("Refreshing demo oracle price...");
      await refreshDemoOracle();
      setPending("Borrowing USDC...");

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
        // A first-time borrower has no USDC token account yet and the program
        // requires it to exist; create it (no-op if it already does) in the
        // same transaction so Borrow works from a fresh wallet.
        .preInstructions([
          createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ownerDebtAta, wallet.publicKey, USDC_MINT!, TOKEN_PROGRAM_ID),
        ])
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
      <div className="glow-field">
        <div className="glow-blob left" />
        <div className="glow-blob right" />
      </div>
      <div className="header" style={{ position: "relative", zIndex: 1 }}>
        <a href="/landing" className="title">
          Vigil<span className="title-sub hide-sm">Dashboard</span>
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <a href="/replay" className="hdr-link">
            Weekend Replay &rarr;
          </a>
          <WalletMultiButton />
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
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
          <div className="panel intro-strip">
            <p>
              <strong>Vigil</strong> is a lending market for tokenized stocks: deposit AAPLx as collateral and
              borrow USDC against it &mdash; including nights and weekends, when the stock market is closed
              and most venues freeze the price.
            </p>
            <p>
              Instead of one price, Vigil uses two: a conservative <span style={{ color: "var(--green)" }}>Borrow-Limit
              Price</span> that caps how much you can borrow, and a wider <span style={{ color: "var(--blue)" }}>Liquidation
              Price</span> that keeps a thin, easily-moved weekend market from liquidating you unfairly.
            </p>
          </div>

          <div className="panel disclosure">
            <span className="disclosure-tag">Disclosed design choice</span>
            <h2 className="disclosure-title">Demo mode: market hours set by hand, price refresh uses stored replay data</h2>
            <p className="disclosure-lead">
              The on-chain open/closed flag is set manually (Pyth&apos;s real market hours are shown beside it), and
              Borrow triggers an oracle refresh that re-posts a stored replay reference price, not a live one.
              Every deposit, borrow and repay is still a real, unscripted transaction on the deployed devnet program.
            </p>
            <details>
              <summary>Details</summary>
              <p>
                Vigil&apos;s oracle takes market hours as an input. Feeding it automatically needs a
                continuously-running off-chain keeper watching real NYSE hours, which is separate
                infrastructure from the on-chain programs built here. So the regime flag reflects
                on-chain state, not a live market-hours check performed at this instant. Only that
                open/closed input is demo-controlled &mdash; the pricing math, the position accounting
                and every transaction are the real deployed programs. Likewise, with no keeper running,
                pressing Borrow first triggers a demo oracle refresh that re-posts the DEX reference price
                already stored on-chain from the Sept 11&ndash;14 replay: a stored price, not a live one.
              </p>
            </details>
          </div>

          <div className="panel">
            <div className="section-title">Market</div>
            <div className="row">
              <span className="label">On-chain regime <span style={{ whiteSpace: "nowrap" }}>(demo-set)</span></span>
              <span className={`badge badge-nowrap ${regimeState?.isOpen ? "open" : "closed"}`}>
                {regimeState ? (regimeState.isOpen ? "Open" : "Closed — Converging") : "Loading..."}
              </span>
            </div>
            <PythMarketRow onchainIsOpen={regimeState ? regimeState.isOpen : null} />
            <div className="row">
              <span className="label">Borrow-Limit Price</span>
              <span className="value" style={{ color: "var(--green)" }}>{regimeState ? fmtUsd(regimeState.borrowLimitPrice) : "—"}</span>
            </div>
            <div className="gloss">
              {regimeState
                ? `When you borrow, each AAPLx of collateral is valued at ${fmtUsd(regimeState.borrowLimitPrice)}.`
                : "The conservative price your collateral is valued at when you borrow."}
            </div>
            <div className="row">
              <span className="label">Liquidation Price</span>
              <span className="value" style={{ color: "var(--blue)" }}>{regimeState ? fmtUsd(regimeState.liquidationPrice) : "—"}</span>
            </div>
            <div className="gloss">
              {regimeState
                ? `Liquidation is checked against ${fmtUsd(regimeState.liquidationPrice)} per AAPLx — deliberately wider, so a brief weekend dip can't liquidate you unfairly.`
                : "A deliberately wider price used only for liquidation checks."}
            </div>
            {readError && <div className="error">Failed to load on-chain state: {readError}</div>}
          </div>

          <div className="panel">
            <div className="section-title">Your Position</div>
            <div className="row">
              <span className="label">Wallet AAPLx balance</span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="value">{(Number(collateralBalance) / 10 ** COLLATERAL_DECIMALS).toFixed(4)}</span>
                <button disabled={!wallet.connected || !!pending} onClick={handleFaucet} style={{ fontSize: 12, padding: "4px 10px" }}>
                  Get Test AAPLx
                </button>
              </span>
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
            <div className="gloss">
              Demo mode: before you borrow, the app refreshes the oracle by re-posting the DEX reference price
              already stored on-chain from the Sept 11&ndash;14 replay &mdash; a stored price, not a live one. It only
              runs while the on-chain regime is closed.
            </div>
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
    </div>
  );
}
