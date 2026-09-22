/**
 * Checks a Solana RPC endpoint before it is used as NEXT_PUBLIC_RPC_ENDPOINT.
 *
 *   npx ts-node --project tsconfig.json scripts/check-rpc.ts <https RPC url>
 *
 * What it verifies, and why it matters here:
 *   1. It is DEVNET (genesis hash), not mainnet. NEXT_PUBLIC_* values are compiled into the public JavaScript
 *      bundle, so anyone can read the URL and its key; a key that only reaches devnet can't be abused against real
 *      funds or a paid mainnet quota.
 *   2. It survives what the app actually does. Each open dashboard tab reads its accounts with getMultipleAccounts every
 *      5 seconds (in chunks of 5 accounts, which some plans cap it at). The pass/fail check simulates several open tabs
 *      doing exactly that, sharing this endpoint, and requires (almost) no failed requests. Two harsher synthetic tests
 *      (a burst, a sustained stream) are reported as headroom warnings only: a shared key with a per-second cap can fail
 *      them while serving real tabs fine, and the app never fires in bursts like that.
 *   3. Its websocket works. Transaction confirmation in @solana/web3.js subscribes over the websocket derived from the URL.
 *
 * Note that a single API key's limit is shared by every visitor to the site, whereas the public endpoint limits each
 * visitor's IP separately, so an endpoint can pass here and still be a lower ceiling overall.
 *
 * It cannot see the provider's dashboard settings. Restrict the key there too (allowed domains/origins, a devnet-only
 * network or plan, a low request quota) since the key is public by construction.
 */
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fires `n` getSlot calls together and returns how many failed. The connection's own 429 retry is off so failures show. */
async function burst(conn: Connection, n: number): Promise<{ failed: number; sample: string | null }> {
  const results = await Promise.allSettled(Array.from({ length: n }, () => conn.getSlot()));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  return { failed: failures.length, sample: failures[0] ? String(failures[0].reason?.message ?? failures[0].reason).slice(0, 120) : null };
}

/** The accounts a dashboard poll reads (same shape as app/lib/useVigilState.ts): 5 accounts in one call, then the rest. */
function dashboardKeys(): PublicKey[] {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "devnet-config.json"), "utf-8"));
  const reserve = new PublicKey(cfg.reserve);
  const debtVault = PublicKey.findProgramAddressSync([Buffer.from("debt_vault"), reserve.toBuffer()], new PublicKey(cfg.lendingMarketProgramId))[0];
  return [new PublicKey(cfg.regimeState), reserve, debtVault, new PublicKey(cfg.collateralMint), SystemProgram.programId];
}

/** Simulates `tabs` open dashboard tabs sharing this endpoint for `seconds`; each polls every 5 s with two concurrent calls. */
async function appShapedLoad(conn: Connection, tabs: number, seconds: number) {
  const keys = dashboardKeys();
  let sent = 0;
  let failed = 0;
  let sample: string | null = null;
  const perSecond = new Map<number, number>();
  const call = async (list: PublicKey[]) => {
    sent++;
    const s = Math.floor(Date.now() / 1000);
    perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
    try {
      await conn.getMultipleAccountsInfo(list);
    } catch (e) {
      failed++;
      sample = sample ?? String((e as Error).message).slice(0, 110);
    }
  };
  const tab = async () => {
    await sleep(Math.random() * 5000); // tabs are opened at different moments
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      await Promise.all([call(keys), call([keys[0]])]); // a connected dashboard: 5 accounts + the wallet account
      await sleep(5000);
    }
  };
  await Promise.all(Array.from({ length: tabs }, tab));
  return { sent, failed, sample, peak: Math.max(...perSecond.values()) };
}

async function main() {
  const url = process.argv[2];
  if (!url || !/^https?:\/\//.test(url)) {
    console.error("usage: check-rpc.ts <https RPC url>");
    process.exit(2);
  }
  const host = new URL(url).host;
  const tabsArg = process.argv.indexOf("--tabs");
  const TABS = tabsArg >= 0 ? Number(process.argv[tabsArg + 1]) : 8;
  // disableRetryOnRateLimit: report 429s instead of quietly retrying them
  const conn = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  const results: { name: string; ok: boolean; detail: string }[] = [];
  // "warn" results are informational headroom, not part of the verdict
  const check = (name: string, ok: boolean, detail: string, warnOnly = false) => {
    results.push({ name, ok: ok || warnOnly, detail });
    console.log(`${ok ? "PASS" : warnOnly ? "WARN" : "FAIL"}  ${name}: ${detail}`);
  };

  console.log(`checking ${host}\n`);

  // 1. cluster
  try {
    const genesis = await conn.getGenesisHash();
    const cluster = genesis === DEVNET_GENESIS ? "devnet" : genesis === MAINNET_GENESIS ? "MAINNET" : "unknown";
    check("cluster is devnet", genesis === DEVNET_GENESIS, `genesis ${genesis.slice(0, 8)}… = ${cluster}`);
  } catch (e) {
    check("cluster is devnet", false, "could not read genesis hash: " + String((e as Error).message).slice(0, 100));
  }

  // 2a. latency
  try {
    const t = Date.now();
    await conn.getSlot();
    const ms = Date.now() - t;
    check("responds promptly", ms < 1500, `getSlot took ${ms} ms`);
  } catch (e) {
    check("responds promptly", false, String((e as Error).message).slice(0, 100));
  }

  // 2a'. the call the app makes: getMultipleAccounts with 5 accounts (some plans cap it at 5, and reject more)
  try {
    const infos = await conn.getMultipleAccountsInfo(dashboardKeys());
    check("getMultipleAccounts with 5 accounts", infos.length === 5, `${infos.filter(Boolean).length}/5 accounts returned`);
  } catch (e) {
    check("getMultipleAccounts with 5 accounts", false, String((e as Error).message).slice(0, 120));
  }

  // 2b. burst: what a handful of tabs opening at once looks like (headroom only)
  const b1 = await burst(conn, 40);
  check("headroom: a burst of 40 parallel requests", b1.failed === 0, b1.failed === 0 ? "0 failed" : `${b1.failed}/40 failed (e.g. ${b1.sample})`, true);

  // 2c. sustained: ~10 requests a second for 10 seconds, about what several open tabs generate
  let sustainedFailed = 0;
  let sample: string | null = null;
  for (let sec = 0; sec < 10; sec++) {
    const r = await burst(conn, 10);
    sustainedFailed += r.failed;
    sample = sample ?? r.sample;
    await sleep(1000);
  }
  check("headroom: ~10 requests/second for 10 seconds", sustainedFailed === 0, sustainedFailed === 0 ? "0 of 100 failed" : `${sustainedFailed}/100 failed (e.g. ${sample})`, true);

  // 2d. the gate: several open dashboard tabs sharing this endpoint
  await sleep(3000);
  const load = await appShapedLoad(conn, TABS, 30);
  const pct = (load.failed / load.sent) * 100;
  check(
    `serves ${TABS} open dashboard tabs sharing it (30 s)`,
    load.failed === 0,
    `${load.sent} requests, ${load.failed} failed (${pct.toFixed(1)}%), peak ${load.peak} in one second${load.sample ? " (e.g. " + load.sample + ")" : ""}`,
  );

  // 3. websocket, needed for transaction confirmation
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (ok: boolean, detail: string) => {
      if (done) return;
      done = true;
      check("websocket subscriptions work", ok, detail);
      resolve();
    };
    const timer = setTimeout(() => finish(false, "no slot notification within 12 s"), 12_000);
    conn
      .onSlotChange(() => {
        clearTimeout(timer);
        finish(true, "received a slot notification");
      });
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "ENDPOINT OK for NEXT_PUBLIC_RPC_ENDPOINT (still restrict the key in the provider dashboard)" : `NOT READY: ${failed.length} check(s) failed`}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
