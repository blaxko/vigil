"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

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
export function useVigilState() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [regimeState, setRegimeState] = useState<RegimeState | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [reserve, setReserve] = useState<Reserve | null>(null);
  const [collateralBalance, setCollateralBalance] = useState<bigint>(BigInt(0));
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
  }, [connection, wallet, configured]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return { configured, regimeState, position, reserve, collateralBalance, readError, refresh };
}
