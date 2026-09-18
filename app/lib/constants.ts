import { PublicKey } from "@solana/web3.js";

/**
 * Devnet-only configuration. Every address here is filled in once the
 * programs are deployed and a reserve is seeded (see /scripts and the
 * README's "Devnet addresses" section) -- this file has no meaning
 * pointed at mainnet.
 */

export const RPC_ENDPOINT = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "https://api.devnet.solana.com";

export const REGIME_ORACLE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_REGIME_ORACLE_PROGRAM_ID ?? "7PHoqxS9CQxy6vTmDCEqkmB1oNCeCotxFSPg3rKmDQUV",
);
export const LENDING_MARKET_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_LENDING_MARKET_PROGRAM_ID ?? "nKD282jg8NPnVLv5hhPrRk8XRfkan8xj73KP6fNTK5K",
);
export const MOCK_PYTH_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_MOCK_PYTH_PROGRAM_ID ?? "BA6ND81qDqr1spCJsdkQk92Q7wzanvLYBRijSiY9h7Xw",
);

// Set after running scripts/seed-devnet.ts -- see README.
export const AAPLX_MINT = process.env.NEXT_PUBLIC_AAPLX_MINT
  ? new PublicKey(process.env.NEXT_PUBLIC_AAPLX_MINT)
  : null;
export const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT ? new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT) : null;
export const FEED_ID: number[] | null = process.env.NEXT_PUBLIC_FEED_ID
  ? JSON.parse(process.env.NEXT_PUBLIC_FEED_ID)
  : null;

export const COLLATERAL_DECIMALS = 6;
export const PRICE_SCALE = 1_000_000; // matches regime_oracle::math::PRICE_SCALE
