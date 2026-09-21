/**
 * Checks a Solana RPC endpoint before it is used as NEXT_PUBLIC_RPC_ENDPOINT.
 *
 *   npx ts-node --project tsconfig.json scripts/check-rpc.ts <https RPC url>
 *
 * What it verifies, and why it matters here:
 *   1. It is DEVNET (genesis hash), not mainnet. NEXT_PUBLIC_* values are compiled into the public JavaScript
 *      bundle, so anyone can read the URL and its key; a key that only reaches devnet can't be abused against real
 *      funds or a paid mainnet quota.
 *   2. It survives what the app does. The dashboard polls every 5 seconds per open tab, several accounts per poll, and
 *      the public api.devnet.solana.com returns HTTP 429 under that load. The check sends a burst and a sustained
 *      stream and counts failures.
 *   3. Its websocket works. Transaction confirmation in @solana/web3.js subscribes over the websocket derived from the URL.
 *
 * It cannot see the provider's dashboard settings. Restrict the key there too (allowed domains/origins, a devnet-only
 * network or plan, a low request quota) since the key is public by construction.
 */
import { Connection } from "@solana/web3.js";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fires `n` getSlot calls together and returns how many failed. The connection's own 429 retry is off so failures show. */
async function burst(conn: Connection, n: number): Promise<{ failed: number; sample: string | null }> {
  const results = await Promise.allSettled(Array.from({ length: n }, () => conn.getSlot()));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  return { failed: failures.length, sample: failures[0] ? String(failures[0].reason?.message ?? failures[0].reason).slice(0, 120) : null };
}

async function main() {
  const url = process.argv[2];
  if (!url || !/^https?:\/\//.test(url)) {
    console.error("usage: check-rpc.ts <https RPC url>");
    process.exit(2);
  }
  const host = new URL(url).host;
  // disableRetryOnRateLimit: report 429s instead of quietly retrying them
  const conn = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  const results: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
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

  // 2b. burst: what a handful of tabs opening at once looks like
  const b1 = await burst(conn, 40);
  check("handles a burst of 40 parallel requests", b1.failed === 0, b1.failed === 0 ? "0 failed" : `${b1.failed}/40 failed (e.g. ${b1.sample})`);

  // 2c. sustained: ~10 requests a second for 10 seconds, about what several open tabs generate
  let sustainedFailed = 0;
  let sample: string | null = null;
  for (let sec = 0; sec < 10; sec++) {
    const r = await burst(conn, 10);
    sustainedFailed += r.failed;
    sample = sample ?? r.sample;
    await sleep(1000);
  }
  check("handles ~10 requests/second for 10 seconds", sustainedFailed === 0, sustainedFailed === 0 ? "0 of 100 failed" : `${sustainedFailed}/100 failed (e.g. ${sample})`);

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
