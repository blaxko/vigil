"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const LINKS: { href: string; label: string; match?: string; hideSm?: boolean }[] = [
  { href: "/#pricing", label: "How it works", hideSm: true },
  { href: "/#solana", label: "Why Solana", hideSm: true },
  { href: "/replay", label: "Replay", match: "/replay" },
  { href: "/app", label: "Dashboard", match: "/app", hideSm: true },
];

/** One header for all three pages: same links, same order, current page marked.
 * `right` replaces the default Launch App button (the dashboard puts the wallet there). */
export function SiteNav({ right }: { right?: ReactNode }) {
  const pathname = usePathname();
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
            className={[l.hideSm ? "nav-opt" : "", l.match && pathname === l.match ? "active" : ""].join(" ").trim() || undefined}
            aria-current={l.match && pathname === l.match ? "page" : undefined}
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
