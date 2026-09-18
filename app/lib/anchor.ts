import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

import regimeOracleIdl from "./idl/regime_oracle.json";
import lendingMarketIdl from "./idl/lending_market.json";
import mockPythIdl from "./idl/mock_pyth.json";

/** Builds an AnchorProvider from a connected wallet-adapter wallet. Throws
 * with a clear message if the wallet isn't actually connected yet, rather
 * than letting a null-signer error surface later inside a transaction. */
export function getProvider(connection: Connection, wallet: WalletContextState): AnchorProvider {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error("Wallet is not connected");
  }
  return new AnchorProvider(
    connection,
    {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions ?? (async (txs) => Promise.all(txs.map((t) => wallet.signTransaction!(t)))),
    },
    { commitment: "confirmed" },
  );
}

/** A provider with no real signing capability, for read-only account
 * fetches (e.g. rendering the dashboard before a wallet connects). Any
 * attempt to actually sign with it throws immediately rather than
 * silently failing. */
export function getReadOnlyProvider(connection: Connection): AnchorProvider {
  return new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async <T extends Transaction | VersionedTransaction>(): Promise<T> => {
        throw new Error("Read-only provider cannot sign transactions -- connect a wallet first.");
      },
      signAllTransactions: async <T extends Transaction | VersionedTransaction>(): Promise<T[]> => {
        throw new Error("Read-only provider cannot sign transactions -- connect a wallet first.");
      },
    },
    { commitment: "confirmed" },
  );
}

export function getRegimeOracleProgram(provider: AnchorProvider): Program {
  return new Program(regimeOracleIdl as Idl, provider);
}

export function getLendingMarketProgram(provider: AnchorProvider): Program {
  return new Program(lendingMarketIdl as Idl, provider);
}

export function getMockPythProgram(provider: AnchorProvider): Program {
  return new Program(mockPythIdl as Idl, provider);
}
