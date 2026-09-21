import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * TEMPORARY diagnostic (delete after use): reports what the deployed container actually
 * contains, to tell a serving problem apart from a source problem. Read-only, exposes no
 * secrets: only the commit SHA, Node version, build id, and hashes/markers of two source
 * files and two built pages.
 */
export const dynamic = "force-dynamic";

// The Next project root is the directory holding .next; it is cwd, or cwd/app when the service
// runs from the repository root.
const cwd = process.cwd();
const root = [cwd, path.join(cwd, "app")].find((d) => fs.existsSync(path.join(d, ".next", "BUILD_ID"))) ?? cwd;
const read = (p: string): string | null => {
  try {
    return fs.readFileSync(path.join(root, p), "utf8");
  } catch {
    return null;
  }
};
const sha = (s: string) => crypto.createHash("sha256").update(s.replace(/\r\n/g, "\n")).digest("hex");

function source(p: string) {
  const s = read(p);
  if (s === null) return { exists: false };
  return {
    exists: true,
    sha256: sha(s),
    bytes: s.length,
    exportsLandingPage: /export default function LandingPage/.test(s),
    exportsAppPage: /export default function AppPage/.test(s),
    rendersDashboard: /<Dashboard \/>/.test(s),
  };
}

function built(p: string) {
  const s = read(p);
  if (s === null) return { exists: false };
  return {
    exists: true,
    bytes: s.length,
    hasLandingHero: s.includes("Borrow Against"),
    hasDashboardForms: s.includes("Withdraw Collateral"),
    title: (s.match(/<title>([^<]*)<\/title>/) || [])[1] ?? null,
  };
}

function json(p: string): unknown {
  const s = read(p);
  if (s === null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return "unparseable";
  }
}

function serverEntry(p: string) {
  const s = read(p);
  if (s === null) return { exists: false };
  return {
    exists: true,
    bytes: s.length,
    hasLandingText: s.includes("Borrow Against"),
    mentionsDashboardTsx: s.includes("Dashboard.tsx") || s.includes("components/Dashboard"),
    mentionsHeroLiveStrip: s.includes("HeroLiveStrip"),
    mentionsLandingPageFn: s.includes("LandingPage"),
    mentionsAppPageFn: s.includes("AppPage"),
  };
}

export async function GET() {
  const dir = (p: string) => {
    try {
      return fs.readdirSync(path.join(root, p)).sort();
    } catch {
      return null;
    }
  };
  return NextResponse.json({
    commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    commitMessage: process.env.RAILWAY_GIT_COMMIT_MESSAGE ?? null,
    branch: process.env.RAILWAY_GIT_BRANCH ?? null,
    node: process.version,
    cwd,
    projectRoot: root,
    projectRootEntries: (() => {
      try {
        return fs.readdirSync(root).sort();
      } catch {
        return null;
      }
    })(),
    buildId: read(".next/BUILD_ID"),
    sourceOnDisk: {
      "app/page.tsx (route /)": source("app/page.tsx"),
      "app/app/page.tsx (route /app)": source("app/app/page.tsx"),
    },
    builtOutput: {
      "/ (.next/server/app/index.html)": built(".next/server/app/index.html"),
      "/app (.next/server/app/app.html)": built(".next/server/app/app.html"),
    },
    // Next's own route -> compiled-file mapping, and what each compiled entry actually contains.
    appPathsManifest: json(".next/server/app-paths-manifest.json"),
    compiledEntries: {
      "app/page.js (route /)": serverEntry(".next/server/app/page.js"),
      "app/app/page.js (route /app)": serverEntry(".next/server/app/app/page.js"),
      "client refs for / ": serverEntry(".next/server/app/page_client-reference-manifest.js"),
      "client refs for /app": serverEntry(".next/server/app/app/page_client-reference-manifest.js"),
    },
    prerenderRoutes: (() => {
      const m = json(".next/prerender-manifest.json") as { routes?: Record<string, unknown> } | null;
      return m && m.routes ? Object.keys(m.routes).sort() : null;
    })(),
    // Names only, never values: which builder and Next flags the build ran under.
    envNames: Object.keys(process.env)
      .filter((k) => /^(NODE_ENV|NEXT_|NIXPACKS|RAILPACK|RAILWAY_(?!.*(TOKEN|SECRET|KEY)))/.test(k))
      .sort(),
    nextServerAppEntries: dir(".next/server/app"),
    buildCachePresent: dir(".next/cache") !== null,
  });
}
