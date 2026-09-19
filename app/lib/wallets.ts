/**
 * The only wallets Vigil offers, on every device.
 *
 * Why an allow-list: `WalletProvider` adds EVERY wallet that any installed
 * extension registers through Wallet Standard (there is no opt-out), so the
 * connect list otherwise varies per browser -- e.g. MetaMask or Jupiter appear
 * if their extensions are installed, and on mobile user agents the provider
 * also injects a "Mobile Wallet Adapter" entry. Those wallets register as
 * Solana-capable, but Vigil has only been exercised against Phantom and
 * Solflare, so those are the two it offers. Both have a real mobile path (an
 * in-app-browser deep link when the wallet is not injected).
 */
export const ALLOWED_WALLET_NAMES: readonly string[] = ["Phantom", "Solflare"];

export const isAllowedWallet = (name: string | null | undefined): boolean =>
  !!name && ALLOWED_WALLET_NAMES.includes(name);

/** wallet-adapter persists the last selected wallet under this key and
 * auto-connects to it. If it names a wallet we no longer offer (say, MetaMask
 * chosen before the allow-list existed), drop it so it can't silently
 * reconnect. Safe to call before `WalletProvider` mounts. */
export function sanitizeStoredWalletName(storageKey = "walletName"): void {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return;
    const name = JSON.parse(raw);
    if (!isAllowedWallet(name)) window.localStorage.removeItem(storageKey);
  } catch {
    // storage unavailable or unparsable -- nothing to sanitize
  }
}
