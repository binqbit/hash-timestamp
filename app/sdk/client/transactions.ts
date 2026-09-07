/** Signing policy shared by transaction methods; instruction assembly stays in the client. */
import type { AnchorProvider, Provider } from "@coral-xyz/anchor";
import type {
  Keypair,
  PublicKey,
  Signer,
  TransactionSignature,
} from "@solana/web3.js";

interface SubmittableInstruction {
  rpc(): Promise<TransactionSignature>;
  signers(signers: Signer[]): SubmittableInstruction;
}

/** Select the instruction signer/rent payer, not the provider's transaction fee payer. */
export function instructionPayer(
  provider: Provider,
  payer?: Keypair
): PublicKey {
  if (payer) return payer.publicKey;
  return (provider as AnchorProvider).wallet.publicKey;
}

export function submitInstruction(
  builder: SubmittableInstruction,
  payer?: Keypair
): Promise<TransactionSignature> {
  return payer ? builder.signers([payer]).rpc() : builder.rpc();
}
