import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

/**
 * Devnet-only test-token faucet. Mints a fixed amount of AAPLx to the
 * caller's wallet using the reserve's mint authority. This is safe only
 * because AAPLx has no real value here -- an endpoint like this must never
 * exist against a mint with real value or authority.
 */

const RPC_ENDPOINT = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "https://api.devnet.solana.com";
const AAPLX_MINT = process.env.NEXT_PUBLIC_AAPLX_MINT;
const FAUCET_AMOUNT_BASE = 100_000_000n; // 100 AAPLx at 6 decimals

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
  try {
    if (!AAPLX_MINT) {
      return NextResponse.json({ error: "Faucet not configured: AAPLX_MINT missing." }, { status: 500 });
    }
    const { wallet } = await req.json();
    if (typeof wallet !== "string") {
      return NextResponse.json({ error: "Missing wallet address." }, { status: 400 });
    }
    let owner: PublicKey;
    try {
      owner = new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    }

    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const mintAuthority = loadMintAuthority();
    const mint = new PublicKey(AAPLX_MINT);

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
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
