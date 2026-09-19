"use client";

import React, { useEffect, useMemo } from "react";
import { ConnectionProvider, WalletContext, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { RPC_ENDPOINT } from "@/lib/constants";
import { isAllowedWallet, sanitizeStoredWalletName } from "@/lib/wallets";

import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Re-provides the wallet context with only the allow-listed wallets, so the
 * stock connect modal (and its mobile deep-link handling) lists exactly
 * Phantom and Solflare no matter what other wallet extensions are installed.
 * See lib/wallets.ts for why this is necessary.
 */
function AllowListedWallets({ children }: { children: React.ReactNode }) {
  const ctx = useWallet();

  // Belt and braces: if a non-allow-listed wallet ever ends up selected, unselect it.
  const { wallet, select } = ctx;
  useEffect(() => {
    if (wallet && !isAllowedWallet(wallet.adapter.name)) select(null);
  }, [wallet, select]);

  const value = useMemo(
    () => ({ ...ctx, wallets: ctx.wallets.filter((w) => isAllowedWallet(w.adapter.name)) }),
    [ctx],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // PhantomWalletAdapter and SolflareWalletAdapter are explicitly included
  // because they implement a real mobile path (an iOS universal-link redirect
  // into the wallet app when not injected, and an "Install"/"Open" state on
  // Android) instead of leaving a plain mobile browser with an empty list.
  // When a wallet's extension registers itself via Wallet Standard, that
  // registration takes precedence over these adapters (same name).
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  // Must run before WalletProvider reads its persisted selection (auto-connect).
  if (typeof window !== "undefined") sanitizeStoredWalletName();

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <AllowListedWallets>
          <WalletModalProvider>{children}</WalletModalProvider>
        </AllowListedWallets>
      </WalletProvider>
    </ConnectionProvider>
  );
}
