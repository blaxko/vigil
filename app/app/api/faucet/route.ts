import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

/**
 * Devnet-only test-token faucet. Mints a fixed amount of AAPLx to the
 * caller's wallet using the reserve's mint authority. This is safe only
 * because AAPLx has no real value here -- an endpoint like this must never
 * exist against a mint with real value or authority.
 *
 * Limits exist because each mint costs the mint authority real devnet SOL (fee plus
 * token-account rent) and unlimited AAPLx would let one caller borrow the market's
 * whole USDC balance. They are in-memory, so they reset when the server restarts and
 * are per instance; that is enough for a single-instance devnet deployment.
 */

const RPC_ENDPOINT = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "https://api.devnet.solana.com";
const AAPLX_MINT = process.env.NEXT_PUBLIC_AAPLX_MINT;
const FAUCET_AMOUNT_BASE = BigInt(10_000_000); // 10 AAPLx at 6 decimals

const WALLET_COOLDOWN_MS = 30 * 60 * 1000; // one drip per wallet every 30 minutes
const IP_LIMIT = 5; // per client address per hour
const GLOBAL_LIMIT = 30; // per hour across everyone
const WINDOW_MS = 60 * 60 * 1000;

const lastByWallet = new Map<string, number>();
const hitsByIp = new Map<string, number[]>();
let globalHits: number[] = [];

const recent = (hits: number[], now: number) => hits.filter((t) => now - t < WINDOW_MS);
const tooMany = (message: string, retryAfterSecs: number) =>
  NextResponse.json({ error: message }, { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSecs)) } });

/** The address the edge proxy saw. x-forwarded-for can carry client-supplied entries at the
 * front, so prefer x-real-ip and otherwise take the last (proxy-appended) entry. */
function clientAddress(req: NextRequest): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",").pop()!.trim();
  return "unknown";
}

function loadMintAuthority(): Keypair {
  const raw = process.env.MINT_AUTHORITY_SECRET_KEY;
  if (raw) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  const keypairPath = (process.env.MINT_AUTHORITY_KEYPAIR_PATH ?? "~/.config/solana/id.json").replace(
    /^~/,
    os.homedir(),
  );
  const bytes = JSON.parse(fs.readFileSync(path.resolve(keypairPath), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export async function POST(req: NextRequest) {
  let walletKey: string | null = null;
  try {
    if (!AAPLX_MINT) {
      console.error("[faucet] NEXT_PUBLIC_AAPLX_MINT is not set");
      return NextResponse.json({ error: "The test faucet is unavailable right now." }, { status: 503 });
    }
    const body = await req.json().catch(() => null);
    const wallet = body && typeof body === "object" ? (body as { wallet?: unknown }).wallet : undefined;
    if (typeof wallet !== "string") {
      return NextResponse.json({ error: "Missing wallet address." }, { status: 400 });
    }
    let owner: PublicKey;
    try {
      owner = new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    }

    // --- limits, checked before any RPC or spend
    const now = Date.now();
    const last = lastByWallet.get(owner.toBase58());
    if (last !== undefined && now - last < WALLET_COOLDOWN_MS) {
      const mins = Math.ceil((WALLET_COOLDOWN_MS - (now - last)) / 60_000);
      return tooMany(`This wallet already got test AAPLx recently. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`, Math.ceil((WALLET_COOLDOWN_MS - (now - last)) / 1000));
    }
    const ip = clientAddress(req);
    const ipHits = recent(hitsByIp.get(ip) ?? [], now);
    if (ipHits.length >= IP_LIMIT) {
      return tooMany("Too many faucet requests from your connection. Try again in a while.", Math.ceil((WINDOW_MS - (now - ipHits[0])) / 1000));
    }
    globalHits = recent(globalHits, now);
    if (globalHits.length >= GLOBAL_LIMIT) {
      return tooMany("The test faucet is busy right now. Try again in a few minutes.", Math.ceil((WINDOW_MS - (now - globalHits[0])) / 1000));
    }

    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const mint = new PublicKey(AAPLX_MINT);

    // A wallet that already holds a full drip doesn't need another.
    const existing = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
    const bal = await connection.getTokenAccountBalance(existing).catch(() => null);
    if (bal && BigInt(bal.value.amount) >= FAUCET_AMOUNT_BASE) {
      return NextResponse.json(
        { error: "You already have test AAPLx in this wallet. Deposit some, then come back for more." },
        { status: 409 },
      );
    }

    // Reserve the slot now so parallel requests can't slip past the limits.
    walletKey = owner.toBase58();
    lastByWallet.set(walletKey, now);
    hitsByIp.set(ip, [...ipHits, now]);
    globalHits.push(now);

    const mintAuthority = loadMintAuthority();
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      mint,
      owner,
      false,
      "confirmed",
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    const signature = await mintTo(
      connection,
      mintAuthority,
      mint,
      ata.address,
      mintAuthority,
      FAUCET_AMOUNT_BASE,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
    );

    return NextResponse.json({ signature, amountBase: FAUCET_AMOUNT_BASE.toString() });
  } catch (e) {
    // The mint didn't happen, so don't make the wallet wait out a cooldown for it.
    if (walletKey) lastByWallet.delete(walletKey);
    console.error("[faucet] mint failed", e);
    return NextResponse.json({ error: "The faucet couldn't mint right now. Try again in a moment." }, { status: 500 });
  }
}
