"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// The dashboard is served at /app but its route folder is /dashboard (see next.config.js), and
// usePathname can report either, so both count as "current".
const LINKS: { href: string; label: string; match?: string[]; hideSm?: boolean }[] = [
  { href: "/#pricing", label: "How it works", hideSm: true },
  { href: "/#solana", label: "Why Solana", hideSm: true },
  { href: "/replay", label: "Replay", match: ["/replay"] },
  { href: "/app", label: "Dashboard", match: ["/app", "/dashboard"], hideSm: true },
];

/** One header for all three pages: same links, same order, current page marked.
 * `right` replaces the default Launch App button (the dashboard puts the wallet there). */
export function SiteNav({ right }: { right?: ReactNode }) {
  const pathname = usePathname();
  const isCurrent = (match?: string[]) => !!pathname && !!match?.includes(pathname);
  return (
    <nav className="lp-nav" aria-label="Main">
      <Link href="/" className="lp-wordmark">
        Vigil
      </Link>
      <div className="lp-nav-links">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={[l.hideSm ? "nav-opt" : "", isCurrent(l.match) ? "active" : ""].join(" ").trim() || undefined}
            aria-current={isCurrent(l.match) ? "page" : undefined}
          >
            {l.label}
          </Link>
        ))}
        <a href="https://github.com/blaxko/vigil" target="_blank" rel="noreferrer" className="nav-opt">
          GitHub
        </a>
      </div>
      {right ?? (
        <Link href="/app" className="btn-gradient">
          Launch App
        </Link>
      )}
    </nav>
  );
}
