"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { RPC_ENDPOINT } from "@/lib/constants";

import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  // Wallet Standard auto-detection alone (wallets={[]}) covers desktop
  // browser extensions, but leaves mobile web with no fallback at all --
  // there's no injected provider to detect on a plain mobile browser, so
  // the modal would show nothing actionable. PhantomWalletAdapter and
  // SolflareWalletAdapter are explicitly included because they implement
  // a real mobile path: an iOS universal-link redirect into the wallet
  // app when not detected, and an "Install"/"Open" state on Android
  // rather than an empty list. These two are deliberately targeted,
  // lightweight standalone packages -- not the much heavier
  // @solana/wallet-adapter-wallets bundle, which pulls in unrelated
  // React Native / Mobile Wallet Adapter dependencies this project
  // doesn't use (see git history for why that was removed once already).
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
