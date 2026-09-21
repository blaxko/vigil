/**
 * Tops the devnet market's USDC (mock) vault back up to a target balance.
 *
 * The USDC Vigil lends is a mock mint whose authority is the deployer, and the debt vault is
 * seeded once by `seed:devnet`. Borrowers draw it down and there is no lender deposit flow, so
 * if the vault runs low (or someone borrows a lot with faucet AAPLx), run this to refill it.
 *
 *   npm run refill:vault                 # top up to 1,000,000 USDC
 *   npm run refill:vault -- --to 250000  # top up to a different target
 *   npm run refill:vault -- --dry-run    # only print the current balance
 *
 * Signs with ANCHOR_WALLET (default ~/.config/solana/id.json), which must be the debt mint's authority.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getMint, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

function loadKeypair(p: string): Keypair {
  const resolved = p.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? "");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf-8"))));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const toIdx = args.indexOf("--to");
  const targetUsdc = toIdx >= 0 ? Number(args[toIdx + 1]) : 1_000_000;
  if (!Number.isFinite(targetUsdc) || targetUsdc <= 0) throw new Error("--to must be a positive number of USDC");

  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "devnet-config.json"), "utf-8"));
  const connection = new Connection(config.rpc, "confirmed");
  const debtMint = new PublicKey(config.debtMint);

  // The vault is a PDA of the reserve; read its address from the reserve account rather than re-deriving it.
  const [debtVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("debt_vault"), new PublicKey(config.reserve).toBuffer()],
    new PublicKey(config.lendingMarketProgramId),
  );
  const vault = await getAccount(connection, debtVault, "confirmed", TOKEN_PROGRAM_ID);
  const decimals = (await getMint(connection, debtMint, "confirmed", TOKEN_PROGRAM_ID)).decimals;
  const current = Number(vault.amount) / 10 ** decimals;
  console.log(`debt vault ${debtVault.toBase58()}: $${current.toLocaleString("en-US")} available (target $${targetUsdc.toLocaleString("en-US")})`);

  if (dryRun) return;
  if (current >= targetUsdc) {
    console.log("already at or above target; nothing to do");
    return;
  }
  const authority = loadKeypair(process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json");
  const amountBase = BigInt(Math.round((targetUsdc - current) * 10 ** decimals));
  const sig = await mintTo(connection, authority, debtMint, debtVault, authority, amountBase, [], { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
  console.log(`minted $${(Number(amountBase) / 10 ** decimals).toLocaleString("en-US")} to the vault: ${sig}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
