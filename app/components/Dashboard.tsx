"use client";

import React, { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
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
import { SiteNav } from "@/components/SiteNav";

const fmtUsd = (micro: BN) => `$${(Number(micro) / PRICE_SCALE).toFixed(2)}`;

/** A transaction that failed OUR pre-flight simulation. Carries the program
 * logs so the UI can show the real reason instead of only the wallet's generic
 * "simulation failed" warning. */
class SimulationError extends Error {
  logs: string[];
  constructor(err: unknown, logs: string[]) {
    super("Simulation failed. " + JSON.stringify(err));
    // Some failures (e.g. the fee payer account not existing) come back with no
    // program logs at all; keep the raw error so the details are never empty.
    this.logs = logs.length ? logs : ["Simulation error: " + JSON.stringify(err)];
  }
}

function logsOf(err: unknown): string[] {
  if (err instanceof SimulationError) return err.logs;
  const l = (err as { logs?: unknown } | null)?.logs;
  return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : [];
}

/** Simulates the transaction on our own devnet connection BEFORE asking the
 * wallet to sign. If it would fail we stop here with the real program logs; a
 * wallet's own simulation of a failing transaction is what produces its scary
 * "Transaction simulation failed" / "dApp could be malicious" warnings, and
 * those tell the user nothing about the cause. */
async function sendChecked(provider: AnchorProvider, tx: Transaction): Promise<string> {
  const { connection, wallet } = provider;
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
    sigVerify: false,
    commitment: "confirmed",
  });
  if (sim.value.err) throw new SimulationError(sim.value.err, sim.value.logs ?? []);
  return provider.sendAndConfirm(tx);
}

/** Turns a thrown Anchor/web3.js error into a message a user can act on,
 * instead of a raw stack trace or an indefinite spinner. */
function describeTxError(err: unknown): string {
  const logs = logsOf(err);
  const msg = [err instanceof Error ? err.message : String(err), ...logs].join("\n");
  if (/User rejected/i.test(msg)) return "Transaction rejected in wallet.";
  if (
    /AccountNotFound|InsufficientFundsForFee|InsufficientFundsForRent|no record of a prior credit/i.test(msg) ||
    (/insufficient/i.test(msg) && /lamports/i.test(msg))
  )
    return "Your wallet needs a little devnet SOL for fees and account rent. A first deposit or borrow creates accounts that cost a few thousandths of a SOL. Get some at faucet.solana.com, then try again.";
  if (/AccountNotInitialized/.test(msg)) return "A required token account does not exist yet for this wallet.";
  if (/0x1\b/.test(msg) || /insufficient funds/i.test(msg)) return "Insufficient token balance.";
  if (/StalePythPrice|StaleOraclePrices/.test(msg))
    return "The oracle price is out of date and the automatic refresh didn't run. The refresh only works while pricing mode is closed. Deposits and repayments still work.";
  if (/BorrowLimitExceeded/.test(msg)) return "Amount exceeds your current borrow limit.";
  if (/WithdrawalExceedsLimit/.test(msg)) return "Withdrawal would leave the position under-collateralized.";
  if (/PositionHoldTimeActive/.test(msg)) return "Position is still within its minimum hold time after the last borrow.";
  if (/RepayExceedsDebt/.test(msg)) return "Repay amount exceeds outstanding debt.";
  if (/Simulation failed/i.test(msg)) {
    const line = logs.find((l) => /Error Message|Error Code|failed:|custom program error/i.test(l));
    return `Transaction simulation failed${line ? ": " + line.replace(/^Program log: /, "") : "."}`;
  }
  return msg.split("\n")[0];
}

/** Asks the server to refresh the oracle before Borrow, because
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
  const { setVisible: openWalletModal } = useWalletModal();
  const { configured, regimeState, position, reserve, collateralBalance, readError, refresh } = useVigilState();

  const [depositAmount, setDepositAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<string[]>([]);
  const [lastSig, setLastSig] = useState<string | null>(null);

  const runTx = async (label: string, fn: () => Promise<string>) => {
    setError(null);
    setErrorLogs([]);
    setLastSig(null);
    setPending(label);
    try {
      const sig = await fn();
      setLastSig(sig);
      await refresh();
    } catch (e) {
      console.error("[vigil] transaction failed", e);
      setError(describeTxError(e));
      setErrorLogs(logsOf(e));
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

      const tx = await program.methods
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
        .transaction();
      return sendChecked(provider, tx);
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
      if (!res.ok) {
        console.error("[vigil] faucet request failed", body);
        throw new Error("The test-token faucet is unavailable right now. Try again in a moment.");
      }
      return body.signature as string;
    });

  const handleBorrow = () =>
    runTx("Borrowing USDC...", async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first.");
      const amount = Number(borrowAmount);
      if (!amount || amount <= 0) throw new Error("Enter a positive borrow amount.");

      setPending("Refreshing oracle price...");
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

      const tx = await program.methods
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
        .transaction();
      return sendChecked(provider, tx);
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

      const tx = await program.methods
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
        .transaction();
      return sendChecked(provider, tx);
    });

  const maxBorrowable =
    regimeState && position && reserve
      ? (Number(position.collateralBase) / 10 ** COLLATERAL_DECIMALS) * (Number(regimeState.borrowLimitPrice) / PRICE_SCALE) * (reserve.maxLtvBps / 10_000)
      : null;

  const walletUi = Number(collateralBalance) / 10 ** COLLATERAL_DECIMALS;
  const collateralUi = position ? Number(position.collateralBase) / 10 ** COLLATERAL_DECIMALS : 0;
  const debtUsd = position ? Number(position.debtAmount) / 10 ** 6 : 0;
  const availableToBorrow = maxBorrowable !== null ? Math.max(0, maxBorrowable - debtUsd) : null;
  const hasPosition = collateralUi > 0 || debtUsd > 0;

  // Health factor and liquidation trigger use the same formula as the program's
  // health_factor_bps: collateral valued at the Liquidation Price, scaled by the
  // reserve's liquidation threshold, divided by debt. Read-only, derived from state
  // already fetched.
  const liqThreshold = reserve ? reserve.liquidationThresholdBps / 10_000 : null;
  const liqPriceUsd = regimeState ? Number(regimeState.liquidationPrice) / PRICE_SCALE : null;
  const healthFactor =
    debtUsd > 0 && collateralUi > 0 && liqThreshold !== null && liqPriceUsd !== null
      ? (collateralUi * liqPriceUsd * liqThreshold) / debtUsd
      : null;
  const healthTone = healthFactor === null ? "" : healthFactor < 1.1 ? "c-red" : healthFactor < 1.5 ? "c-amber" : "c-green";
  const liquidationTrigger =
    debtUsd > 0 && collateralUi > 0 && liqThreshold !== null ? debtUsd / (collateralUi * liqThreshold) : null;
  const pct = (bps: number) => (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1) + "%";

  // Inline validation: empty input is neutral; anything else is checked before
  // the wallet is ever asked to sign.
  const validate = (raw: string, check: (n: number) => string | null): string | null => {
    if (raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return "Enter an amount greater than zero.";
    return check(n);
  };
  const depositErr = validate(depositAmount, (n) =>
    n > walletUi + 1e-9 ? "Exceeds your wallet balance (" + walletUi.toFixed(4) + " AAPLx)." : null,
  );
  const borrowErr = validate(borrowAmount, (n) =>
    collateralUi <= 0
      ? "Deposit collateral first: there is nothing to borrow against yet."
      : availableToBorrow !== null && n > availableToBorrow + 1e-9
        ? "Above what you can borrow right now (about $" + availableToBorrow.toFixed(2) + ")."
        : null,
  );
  const repayErr = validate(repayAmount, (n) =>
    debtUsd <= 0
      ? "You have no outstanding debt."
      : n > debtUsd + 1e-9
        ? "More than your outstanding debt ($" + debtUsd.toFixed(2) + ")."
        : null,
  );

  return (
    <>
      <SiteNav right={<WalletMultiButton />} />
      <div className="page">
        <div className="glow-field">
          <div className="glow-blob left" />
          <div className="glow-blob right" />
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="page-head">
            <h1 className="page-title">AAPLx market</h1>
            <p className="page-sub">Deposit tokenized Apple stock and borrow USDC against it, including nights and weekends.</p>
          </div>

          {!configured && (
            <div className="panel">
              <div className="error">Vigil can&apos;t reach its devnet deployment right now. Try again in a few minutes.</div>
            </div>
          )}

          {configured && (
            <>
              <div className="status-bar dash-status">
                <span className="status-badge">Devnet</span>
                <p className="status-text">
                  Test tokens with no real value. Pricing mode is switched manually in this deployment.
                </p>
                <details className="status-details">
                  <summary>Details</summary>
                  <p>
                    Vigil&apos;s oracle takes market hours as an input, and a keeper watching real exchange hours would
                    normally supply it. This deployment has no keeper, so the open/closed switch is set by hand and
                    Pyth&apos;s live schedule is shown beside it. Borrow also refreshes the oracle with a reference
                    price stored on-chain from the Sept 11&ndash;14 replay, not a live price. The pricing math, position
                    accounting and every deposit, borrow and repay run on the deployed programs.
                  </p>
                </details>
              </div>

              <div className="panel">
                <div className="section-title">Market</div>
                <div className="row">
                  <span className="label">Pricing mode</span>
                  <span className={`badge badge-nowrap ${regimeState?.isOpen ? "open" : "closed"}`}>
                    {regimeState ? (regimeState.isOpen ? "Open · live price" : "Closed · prices converging") : "Loading…"}
                  </span>
                </div>
                <div className="gloss">
                  While the stock market is open, Vigil prices from the live feed. While it is closed, Vigil stops trusting
                  the last print and moves its two prices apart gradually. Switched manually on devnet.
                </div>
                <PythMarketRow onchainIsOpen={regimeState ? regimeState.isOpen : null} />
                <div className="price-tiles">
                  <div className="tag-card compact">
                    <span className="tag tag-green">Borrow-Limit Price</span>
                    <div className="price-tile-value c-green">
                      {regimeState ? fmtUsd(regimeState.borrowLimitPrice) : <span className="skeleton" role="status" aria-label="Loading price" />}
                    </div>
                    <p className="tag-card-body">
                      {regimeState
                        ? `Each AAPLx of collateral counts as ${fmtUsd(regimeState.borrowLimitPrice)} when you borrow. Tightens through closures.`
                        : "The conservative price your collateral is valued at when you borrow."}
                    </p>
                  </div>
                  <div className="tag-card compact">
                    <span className="tag tag-blue">Liquidation Price</span>
                    <div className="price-tile-value c-blue">
                      {regimeState ? fmtUsd(regimeState.liquidationPrice) : <span className="skeleton" role="status" aria-label="Loading price" />}
                    </div>
                    <p className="tag-card-body">
                      {regimeState
                        ? `Liquidation is checked against ${fmtUsd(regimeState.liquidationPrice)} per AAPLx. It is deliberately wider, so a brief weekend dip can't liquidate you unfairly. Widens through closures.`
                        : "A deliberately wider price used only for liquidation checks."}
                    </p>
                  </div>
                </div>
                <div className="param-grid" aria-label="Reserve parameters">
                  <div className="param">
                    <span>Max LTV</span>
                    <b>{reserve ? pct(reserve.maxLtvBps) : "—"}</b>
                  </div>
                  <div className="param">
                    <span>Liquidation threshold</span>
                    <b>{reserve ? pct(reserve.liquidationThresholdBps) : "—"}</b>
                  </div>
                  <div className="param">
                    <span>Liquidator bonus</span>
                    <b>{reserve ? pct(reserve.liquidationBonusBps) : "—"}</b>
                  </div>
                  <div className="param">
                    <span>Deposited / borrowed</span>
                    <b>
                      {reserve
                        ? `${(Number(reserve.totalCollateralBase) / 10 ** COLLATERAL_DECIMALS).toFixed(2)} AAPLx / $${(Number(reserve.totalDebt) / 10 ** 6).toFixed(2)}`
                        : "—"}
                    </b>
                  </div>
                </div>
                {readError && (
                  <div className="error">Couldn&apos;t load on-chain data from devnet. Retrying automatically.</div>
                )}
              </div>

              <div className="panel">
                <div className="section-title">Your Position</div>
                {!wallet.connected && (
                  <div className="empty-state">
                    <p>Connect a wallet on Solana devnet to see your balance and open a position.</p>
                    <button type="button" className="empty-cta" onClick={() => openWalletModal(true)}>
                      Connect wallet
                    </button>
                    <details className="empty-help">
                      <summary>Setting up a devnet wallet</summary>
                      <p>
                        Switch your wallet to devnet (Phantom: Settings &rarr; Developer Settings &rarr; Testnet Mode;
                        Solflare: Settings &rarr; Network &rarr; Devnet) and keep a little devnet SOL for fees from{" "}
                        <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>.
                        &ldquo;Get Test AAPLx&rdquo; mints the test token only, not SOL.
                      </p>
                    </details>
                  </div>
                )}
                {wallet.connected && !hasPosition && (
                  <div className="empty-state">
                    <p>No position yet. Get some test AAPLx, then deposit it below to open one.</p>
                  </div>
                )}
                <div className="row">
                  <span className="label">Wallet AAPLx balance</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="value">{walletUi.toFixed(4)}</span>
                    <button disabled={!wallet.connected || !!pending} onClick={handleFaucet} style={{ fontSize: 12, padding: "4px 10px" }}>
                      Get Test AAPLx
                    </button>
                  </span>
                </div>
                <div className="pos-tiles">
                  <div className="stat-tile">
                    <div className="stat-label">Deposited collateral</div>
                    <div className="stat-value">{collateralUi.toFixed(4)}</div>
                    <div className="stat-note">AAPLx</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-label">Outstanding debt</div>
                    <div className="stat-value">{"$" + debtUsd.toFixed(2)}</div>
                    <div className="stat-note">USDC</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-label">Max borrowable</div>
                    <div className="stat-value">{maxBorrowable !== null ? `$${maxBorrowable.toFixed(2)}` : "—"}</div>
                    <div className="stat-note">at the Borrow-Limit Price</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-label">Health factor</div>
                    <div className={`stat-value ${healthTone}`}>{healthFactor !== null ? healthFactor.toFixed(2) : "—"}</div>
                    <div className="stat-note">{debtUsd > 0 ? "Liquidatable below 1.00" : "Shown once you borrow"}</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-label">Liquidation trigger</div>
                    <div className="stat-value">{liquidationTrigger !== null ? `$${liquidationTrigger.toFixed(2)}` : "—"}</div>
                    <div className="stat-note">
                      {liquidationTrigger !== null && liqPriceUsd !== null
                        ? `Liquidation Price now $${liqPriceUsd.toFixed(2)}`
                        : "Liquidation Price at which you'd be liquidated"}
                    </div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-label">Available to borrow</div>
                    <div className="stat-value">{availableToBorrow !== null ? `$${availableToBorrow.toFixed(2)}` : "—"}</div>
                    <div className="stat-note">Max borrowable less debt</div>
                  </div>
                </div>
              </div>

              {!wallet.connected && <div className="field-hint form-hint">Connect a wallet to use the forms below.</div>}

              <div className="panel">
                <div className="section-title">Deposit Collateral</div>
                <div className="form-row">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="AAPLx amount"
                    aria-label="AAPLx amount to deposit"
                    aria-invalid={!!depositErr}
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary max"
                    disabled={!wallet.connected || !!pending || walletUi <= 0}
                    onClick={() => setDepositAmount(String(walletUi))}
                  >
                    Max
                  </button>
                  <button disabled={!wallet.connected || !!pending || !depositAmount || !!depositErr} onClick={handleDeposit}>
                    Deposit
                  </button>
                </div>
                {depositErr && <div className="field-error" role="alert">{depositErr}</div>}
              </div>

              <div className="panel">
                <div className="section-title">Borrow USDC</div>
                <div className="gloss">
                  Before each borrow, Vigil refreshes the oracle with the reference price stored on-chain from the Sept
                  11&ndash;14 replay. It is not a live price, and the refresh only runs while pricing mode is closed.
                </div>
                <div className="form-row">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="USDC amount"
                    aria-label="USDC amount to borrow"
                    aria-invalid={!!borrowErr}
                    value={borrowAmount}
                    onChange={(e) => setBorrowAmount(e.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary max"
                    disabled={!wallet.connected || !!pending || !availableToBorrow}
                    onClick={() => setBorrowAmount(String(Math.floor((availableToBorrow ?? 0) * 100) / 100))}
                  >
                    Max
                  </button>
                  <button disabled={!wallet.connected || !!pending || !borrowAmount || !!borrowErr} onClick={handleBorrow}>
                    Borrow
                  </button>
                </div>
                {borrowErr && <div className="field-error" role="alert">{borrowErr}</div>}
              </div>

              <div className="panel">
                <div className="section-title">Repay</div>
                <div className="form-row">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="USDC amount"
                    aria-label="USDC amount to repay"
                    aria-invalid={!!repayErr}
                    value={repayAmount}
                    onChange={(e) => setRepayAmount(e.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary max"
                    disabled={!wallet.connected || !!pending || debtUsd <= 0}
                    onClick={() => setRepayAmount(String(debtUsd))}
                  >
                    Max
                  </button>
                  <button disabled={!wallet.connected || !!pending || !repayAmount || !!repayErr} onClick={handleRepay}>
                    Repay
                  </button>
                </div>
                {repayErr && <div className="field-error" role="alert">{repayErr}</div>}
              </div>
              {pending && (
                <div className="pending" role="status">
                  <span className="spinner" aria-hidden="true" />
                  {pending}
                </div>
              )}
              {error && <div className="error">{error}</div>}
              {errorLogs.length > 0 && (
                <details className="tx-logs">
                  <summary>Technical details</summary>
                  <pre>{errorLogs.join("\n")}</pre>
                </details>
              )}
              {lastSig && (
                <div className="success" role="status">
                  Transaction confirmed &middot;{" "}
                  <a href={"https://explorer.solana.com/tx/" + lastSig + "?cluster=devnet"} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                    View on Solana Explorer &#8599;
                  </a>
                  <span className="sig"> {lastSig.slice(0, 8)}&hellip;{lastSig.slice(-6)}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
