import { Dashboard } from "@/components/Dashboard";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "AAPLx market",
  "Deposit tokenized Apple stock and borrow USDC against it, including nights and weekends. Live Borrow-Limit and Liquidation prices, your health factor, and every transaction on Solana devnet.",
);

export default function AppPage() {
  return <Dashboard />;
}
