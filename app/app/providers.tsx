"use client";

import React from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_ENDPOINT } from "@/lib/constants";

import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  // No explicit adapter list: Phantom, Solflare, Backpack, and every other
  // modern wallet implement the Wallet Standard and are auto-detected by
  // @solana/wallet-adapter-react without needing the (very heavy)
  // @solana/wallet-adapter-wallets package, which bundles dozens of
  // legacy, unused wallet SDKs (Ledger, Keystone, Torus, ...).
  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
