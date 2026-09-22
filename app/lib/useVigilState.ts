"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import { AccountLayout, getAssociatedTokenAddressSync, getMint, getScaledUiAmountConfig, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import { AAPLX_MINT, COLLATERAL_DECIMALS, FEED_ID, USDC_MINT } from "@/lib/constants";
import { getLendingMarketProgram, getReadOnlyProvider, getRegimeOracleProgram } from "@/lib/anchor";
import { debtVaultPda, positionPda, regimeStatePda, reservePda } from "@/lib/pda";

export type RegimeState = {
  isOpen: boolean;
  borrowLimitPrice: BN;
  liquidationPrice: BN;
  lastUpdateTs: BN;
};

export type Position = {
  collateralBase: BN;
  debtAmount: BN;
  lastBorrowTs: BN;
};

export type Reserve = {
  debtVault: PublicKey;
  maxLtvBps: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  minHoldTimeSecs: BN;
  totalCollateralBase: BN;
  totalDebt: BN;
};

const POLL_MS = 5000;
const USDC_DECIMALS = 6;
const MAX_ACCOUNTS_PER_CALL = 5;

/** The token amount in a token account's raw data. Token-2022 accounts may be longer (extensions) but start with the same layout. */
function tokenAmount(data: Buffer | Uint8Array): bigint {
  return AccountLayout.decode(Buffer.from(data).subarray(0, AccountLayout.span)).amount;
}
const FAILURES_BEFORE_ERROR = 3; // about 15 seconds of the endpoint being genuinely unreachable

/**
 * The single source of truth for reading Vigil's real on-chain state --
 * used by both the dashboard (/app) and the landing page's live hero
 * preview, so there is exactly one place that knows how to fetch and
 * decode RegimeState/Reserve/Position, not two copies that could drift
 * apart or reintroduce the account-name-casing bug fixed earlier.
 */
export function useVigilState(withLiquidity = false) {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [regimeState, setRegimeState] = useState<RegimeState | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [reserve, setReserve] = useState<Reserve | null>(null);
  // USDC the market can lend right now (the debt vault's balance). Read only when a page asks for it,
  // so pages that don't show it add no RPC calls.
  const [debtLiquidity, setDebtLiquidity] = useState<number | null>(null);
  const [collateralBalance, setCollateralBalance] = useState<bigint>(BigInt(0));
  // The connected wallet's SOL, so the dashboard can warn before a first deposit fails for lack of fees and rent.
  const [solBalance, setSolBalance] = useState<number | null>(null);
  // Token-2022 scaled-UI-amount multiplier of the collateral mint (1.0 when the mint has none). The program
  // values collateral as base amount x this multiplier, so the UI has to as well.
  const [collateralMultiplier, setCollateralMultiplier] = useState(1);
  const [readError, setReadError] = useState<string | null>(null);
  // A single failed poll (a rate-limited or dropped RPC request) is normal; the last good data stays on screen and
  // the error only surfaces once several polls in a row have failed.
  const consecutiveFailures = useRef(0);

  const configured = Boolean(AAPLX_MINT && USDC_MINT && FEED_ID);

  const refresh = useCallback(async () => {
    if (!configured) return;

    const feedId = FEED_ID!;
    const regimeStateAddr = regimeStatePda(feedId);
    const reserveAddr = reservePda(AAPLX_MINT!);
    const readOnlyProvider = getReadOnlyProvider(connection);
    const regimeProgram = getRegimeOracleProgram(readOnlyProvider);
    const lendingProgram = getLendingMarketProgram(readOnlyProvider);

    try {
      // Two requests at most per poll instead of six: everything this page reads goes through getMultipleAccounts.
      // (The debt vault is a fixed PDA of the reserve, so its address is known without decoding the reserve first.)
      type Wanted = "regime" | "reserve" | "vault" | "position" | "ata" | "wallet";
      const wanted: { kind: Wanted; key: PublicKey }[] = [
        { kind: "regime", key: regimeStateAddr },
        { kind: "reserve", key: reserveAddr },
      ];
      if (withLiquidity) wanted.push({ kind: "vault", key: debtVaultPda(reserveAddr) });
      if (wallet.publicKey) {
        wanted.push({ kind: "position", key: positionPda(reserveAddr, wallet.publicKey) });
        wanted.push({ kind: "ata", key: getAssociatedTokenAddressSync(AAPLX_MINT!, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID) });
        wanted.push({ kind: "wallet", key: wallet.publicKey });
      }
      // Some RPC plans cap getMultipleAccounts at 5 accounts per call, so read in chunks of 5, concurrently.
      const chunks: { kind: Wanted; key: PublicKey }[][] = [];
      for (let i = 0; i < wanted.length; i += MAX_ACCOUNTS_PER_CALL) chunks.push(wanted.slice(i, i + MAX_ACCOUNTS_PER_CALL));
      const infos = (await Promise.all(chunks.map((c) => connection.getMultipleAccountsInfo(c.map((w) => w.key))))).flat();
      const info = (kind: Wanted) => infos[wanted.findIndex((w) => w.kind === kind)] ?? null;

      const regimeAccountInfo = info("regime");
      if (regimeAccountInfo) {
        // Anchor's Program constructor normalizes IDL account names to
        // camelCase internally (RegimeState -> regimeState) -- decode
        // must use that normalized name, not the PascalCase Rust struct
        // name, or it throws "Account not found" despite the account
        // genuinely existing. See Dashboard fix commit for the full story.
        const decoded = regimeProgram.coder.accounts.decode("regimeState", regimeAccountInfo.data);
        setRegimeState(decoded as RegimeState);
      }
      const reserveAccountInfo = info("reserve");
      if (reserveAccountInfo) {
        const decoded = lendingProgram.coder.accounts.decode("reserve", reserveAccountInfo.data);
        setReserve(decoded as Reserve);
      }
      if (withLiquidity) {
        const vault = info("vault");
        if (vault) setDebtLiquidity(Number(tokenAmount(vault.data)) / 10 ** USDC_DECIMALS);
      }

      if (wallet.publicKey) {
        const posInfo = info("position");
        if (posInfo) {
          const decoded = lendingProgram.coder.accounts.decode("position", posInfo.data);
          setPosition(decoded as Position);
        } else {
          setPosition(null);
        }

        const ataInfo = info("ata");
        setCollateralBalance(ataInfo ? tokenAmount(ataInfo.data) : BigInt(0));

        // A wallet that has never received SOL has no account at all, which is a balance of zero.
        setSolBalance((info("wallet")?.lamports ?? 0) / 1e9);
      } else {
        setSolBalance(null);
      }
      consecutiveFailures.current = 0;
      setReadError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("vigil state refresh failed", e);
      consecutiveFailures.current += 1;
      if (consecutiveFailures.current >= FAILURES_BEFORE_ERROR) setReadError(msg);
    }
  }, [connection, wallet, configured, withLiquidity]);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const loadMultiplier = async () => {
      try {
        const mint = await getMint(connection, AAPLX_MINT!, "confirmed", TOKEN_2022_PROGRAM_ID);
        const cfg = getScaledUiAmountConfig(mint);
        // Same rule as lending_market's token2022::read_multiplier_fp: the new multiplier applies once its
        // effective timestamp has passed; with no extension the multiplier is 1.0.
        const now = Math.floor(Date.now() / 1000);
        const active = cfg ? (now >= Number(cfg.newMultiplierEffectiveTimestamp) ? cfg.newMultiplier : cfg.multiplier) : 1;
        if (!cancelled && Number.isFinite(active) && active > 0) setCollateralMultiplier(active);
      } catch (e) {
        console.error("vigil: could not read the collateral mint's multiplier", e);
      }
    };
    loadMultiplier();
    const id = setInterval(loadMultiplier, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [connection, configured]);

  useEffect(() => {
    refresh();
    // Poll only while the tab is visible: a background tab has no reader, and every poll is an RPC request.
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { configured, regimeState, position, reserve, debtLiquidity, collateralBalance, collateralMultiplier, solBalance, readError, refresh };
}
