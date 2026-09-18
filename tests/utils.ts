import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeScaledUiAmountConfigInstruction,
  createInitializeMintInstruction,
  createMint as createPlainMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  mintTo,
} from "@solana/spl-token";

/**
 * Reads the Clock sysvar's `unixTimestamp` directly from the connected
 * cluster. Local validators (surfpool/solana-test-validator) do not keep
 * their on-chain Clock synced to the host's wall-clock time, so any
 * staleness-bounded on-chain check (like regime_oracle's Pyth freshness
 * guard) must be compared against *this*, never `Date.now()`.
 */
export async function onChainUnixTimestamp(connection: Connection): Promise<number> {
  const info = await connection.getParsedAccountInfo(anchor.web3.SYSVAR_CLOCK_PUBKEY);
  const parsed = (info.value?.data as any)?.parsed;
  if (!parsed?.info?.unixTimestamp) {
    throw new Error("Could not read Clock sysvar unixTimestamp");
  }
  return Number(parsed.info.unixTimestamp);
}

/** Airdrops `sol` SOL to `pubkey` and confirms it, retrying on devnet rate limits. */
export async function airdrop(connection: Connection, pubkey: PublicKey, sol = 2) {
  const sig = await connection.requestAirdrop(pubkey, sol * anchor.web3.LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

/**
 * Creates a Token-2022 mint with the ScaledUiAmount extension -- the same
 * extension AAPLx uses in production, so tests exercise the real
 * base-amount <-> UI-amount conversion path in `token2022.rs`, not a
 * trivial 1.0-multiplier stand-in.
 */
export async function createScaledUiMint(
  connection: Connection,
  payer: Keypair,
  mintAuthority: PublicKey,
  decimals: number,
  multiplier: number,
): Promise<PublicKey> {
  const mint = Keypair.generate();
  const extensions = [ExtensionType.ScaledUiAmountConfig];
  const space = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(space);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeScaledUiAmountConfigInstruction(
      mint.publicKey,
      mintAuthority,
      multiplier,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(mint.publicKey, decimals, mintAuthority, null, TOKEN_2022_PROGRAM_ID),
  );
  await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer, mint], { commitment: "confirmed" });
  return mint.publicKey;
}

/** Creates a plain SPL Token mint (stand-in for mock USDC), 6 decimals by default. */
export async function createDebtMint(
  connection: Connection,
  payer: Keypair,
  mintAuthority: PublicKey,
  decimals = 6,
): Promise<PublicKey> {
  return createPlainMint(connection, payer, mintAuthority, null, decimals, undefined, undefined, TOKEN_PROGRAM_ID);
}

/** Creates (if needed) an ATA for `owner` on `mint`, under the given token program, and returns its address. */
export async function ensureAta(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const info = await connection.getAccountInfo(ata);
  if (info) return ata;
  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID),
  );
  await anchor.web3.sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
  return ata;
}

export async function mintTokens(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: bigint,
  tokenProgramId: PublicKey,
) {
  await mintTo(connection, payer, mint, destination, authority, amount, [], { commitment: "confirmed" }, tokenProgramId);
}

export { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID };
