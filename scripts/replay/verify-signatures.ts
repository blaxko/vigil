/**
 * Programmatically verifies the finalization status of every unique
 * transaction signature produced by run-replay.ts -- not a spot check.
 * Uses getSignatureStatuses in batches of 256 (the RPC's max per call).
 *
 * Usage: npm run replay:verify
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

interface ReplayTick {
  step: string;
  txSignatures: string[];
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, Math.min(3000 * (i + 1), 20_000)));
    }
  }
  throw lastErr;
}

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../devnet-config.json"), "utf-8"));
  const connection = new Connection(config.rpc, "confirmed");

  const ticks: ReplayTick[] = JSON.parse(fs.readFileSync(path.join(__dirname, "replay-output.json"), "utf-8"));
  const allSigs = ticks.flatMap((t) => t.txSignatures);
  const uniqueSigs = Array.from(new Set(allSigs));

  console.log(`${ticks.length} ticks, ${allSigs.length} total signature slots, ${uniqueSigs.length} unique signatures.`);

  const results: { sig: string; status: string }[] = [];
  const BATCH = 256;
  for (let i = 0; i < uniqueSigs.length; i += BATCH) {
    const batch = uniqueSigs.slice(i, i + BATCH);
    const res = await withRetry(() => connection.getSignatureStatuses(batch, { searchTransactionHistory: true }));
    res.value.forEach((v, idx) => {
      const status = v === null ? "NOT_FOUND" : v.confirmationStatus ?? (v.err ? `ERROR: ${JSON.stringify(v.err)}` : "UNKNOWN");
      results.push({ sig: batch[idx], status });
    });
    console.log(`  checked ${Math.min(i + BATCH, uniqueSigs.length)}/${uniqueSigs.length}`);
  }

  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;

  console.log("\n=== Finalization status breakdown ===");
  for (const [status, count] of Object.entries(counts)) {
    console.log(`  ${status}: ${count}`);
  }

  const notFinalized = results.filter((r) => r.status !== "finalized");
  if (notFinalized.length > 0) {
    console.log("\n=== NOT finalized (needs attention) ===");
    for (const r of notFinalized) console.log(`  ${r.sig}: ${r.status}`);
  }

  fs.writeFileSync(path.join(__dirname, "signature-verification.json"), JSON.stringify({ totalUnique: uniqueSigs.length, counts, results }, null, 2));
  console.log(`\n${counts["finalized"] ?? 0} / ${uniqueSigs.length} unique signatures confirmed FINALIZED.`);
  console.log("Wrote scripts/replay/signature-verification.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
