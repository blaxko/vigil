"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getMint, getScaledUiAmountConfig, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import { AAPLX_MINT, COLLATERAL_DECIMALS, FEED_ID, USDC_MINT } from "@/lib/constants";
import { getLendingMarketProgram, getReadOnlyProvider, getRegimeOracleProgram } from "@/lib/anchor";
import { positionPda, regimeStatePda, reservePda } from "@/lib/pda";

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
  // Token-2022 scaled-UI-amount multiplier of the collateral mint (1.0 when the mint has none). The program
  // values collateral as base amount x this multiplier, so the UI has to as well.
  const [collateralMultiplier, setCollateralMultiplier] = useState(1);
  const [readError, setReadError] = useState<string | null>(null);

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
      const regimeAccountInfo = await connection.getAccountInfo(regimeStateAddr);
      if (regimeAccountInfo) {
        // Anchor's Program constructor normalizes IDL account names to
        // camelCase internally (RegimeState -> regimeState) -- decode
        // must use that normalized name, not the PascalCase Rust struct
        // name, or it throws "Account not found" despite the account
        // genuinely existing. See Dashboard fix commit for the full story.
        const decoded = regimeProgram.coder.accounts.decode("regimeState", regimeAccountInfo.data);
        setRegimeState(decoded as RegimeState);
      }
      const reserveAccountInfo = await connection.getAccountInfo(reserveAddr);
      if (reserveAccountInfo) {
        const decoded = lendingProgram.coder.accounts.decode("reserve", reserveAccountInfo.data);
        setReserve(decoded as Reserve);
        if (withLiquidity) {
          const vault = await connection.getTokenAccountBalance((decoded as Reserve).debtVault).catch(() => null);
          if (vault) setDebtLiquidity(vault.value.uiAmount);
        }
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
      const msg = e instanceof Error ? e.message : String(e);
      console.error("vigil state refresh failed", e);
      setReadError(msg);
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
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return { configured, regimeState, position, reserve, debtLiquidity, collateralBalance, collateralMultiplier, readError, refresh };
}
