import { PublicKey } from "@solana/web3.js";
import { LENDING_MARKET_PROGRAM_ID, MOCK_PYTH_PROGRAM_ID, REGIME_ORACLE_PROGRAM_ID } from "./constants";

export function regimeStatePda(feedId: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("regime_state"), Buffer.from(feedId)],
    REGIME_ORACLE_PROGRAM_ID,
  )[0];
}

export function reservePda(collateralMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("reserve"), collateralMint.toBuffer()], LENDING_MARKET_PROGRAM_ID)[0];
}

export function reserveAuthorityPda(reserve: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reserve_authority"), reserve.toBuffer()],
    LENDING_MARKET_PROGRAM_ID,
  )[0];
}

export function collateralVaultPda(reserve: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault"), reserve.toBuffer()],
    LENDING_MARKET_PROGRAM_ID,
  )[0];
}

export function debtVaultPda(reserve: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("debt_vault"), reserve.toBuffer()], LENDING_MARKET_PROGRAM_ID)[0];
}

export function positionPda(reserve: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), reserve.toBuffer(), owner.toBuffer()],
    LENDING_MARKET_PROGRAM_ID,
  )[0];
}

export function mockPricePda(feedId: number[]): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("mock_price"), Buffer.from(feedId)], MOCK_PYTH_PROGRAM_ID)[0];
}
