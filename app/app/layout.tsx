import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

const SITE_DESCRIPTION =
  "Vigil is a lending market for tokenized stocks on Solana. Deposit AAPLx, borrow USDC, and keep borrowing through nights and weekends, priced by an oracle that knows when the market is shut.";

// Set NEXT_PUBLIC_SITE_URL to the deployed origin so link previews resolve to absolute URLs.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Vigil | Borrow against tokenized stocks, even when the market is closed",
    template: "%s | Vigil",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Vigil",
  openGraph: {
    type: "website",
    siteName: "Vigil",
    title: "Vigil | Borrow against tokenized stocks, even when the market is closed",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Vigil | Borrow against tokenized stocks, even when the market is closed",
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
