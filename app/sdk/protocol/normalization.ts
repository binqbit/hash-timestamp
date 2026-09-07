import { PublicKey } from "@solana/web3.js";
import { HashBytes, NumericLike } from "../types";

interface PublicKeyLike {
  toBase58(): string;
  toBuffer(): Uint8Array;
}

export function publicKeyBytes(input: unknown): Uint8Array | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }

  const candidate = input as Partial<PublicKeyLike>;
  if (
    typeof candidate.toBase58 !== "function" ||
    typeof candidate.toBuffer !== "function"
  ) {
    return undefined;
  }

  const bytes = candidate.toBuffer();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
    throw new Error("public key must be exactly 32 bytes");
  }
  return new Uint8Array(bytes);
}

export function to32Bytes(input: HashBytes): Uint8Array {
  let buf: Buffer;
  if (input instanceof Uint8Array) {
    buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  } else if (Buffer.isBuffer(input)) {
    buf = input;
  } else if (Array.isArray(input)) {
    validateByteArray(input);
    buf = Buffer.from(input);
  } else {
    buf = decodeHex(input);
  }
  if (buf.length !== 32) throw new Error("hash must be exactly 32 bytes");
  return new Uint8Array(buf);
}

export function toBytes(
  input:
    | HashBytes
    | PublicKey
    | Uint8Array
    | Buffer
    | number[]
    | string
    | undefined
): Uint8Array {
  if (input === undefined) {
    return new Uint8Array();
  }
  const keyBytes = publicKeyBytes(input);
  if (keyBytes) {
    return keyBytes;
  }
  if (input instanceof Uint8Array) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (Buffer.isBuffer(input)) {
    return new Uint8Array(input);
  }
  if (Array.isArray(input)) {
    validateByteArray(input);
    return new Uint8Array(input);
  }
  if (typeof input === "string") {
    return new Uint8Array(decodeHex(input));
  }
  return to32Bytes(input as unknown as HashBytes);
}

export function numberToU64(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error("value must be a finite number");
  }
  if (value < 0) {
    throw new Error("value must be non-negative");
  }
  const max = (BigInt(1) << BigInt(64)) - BigInt(1);
  const truncated = Math.floor(value);
  let bigint = BigInt(truncated);
  if (bigint > max) {
    bigint = max;
  }
  return bigint;
}

export function toBigInt(value: NumericLike): bigint {
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (typeof value === "bigint") {
    return value;
  }
  return BigInt(value.toString());
}

export function toI64Bytes(value: NumericLike): Uint8Array {
  const bigintValue = asI64(value);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(bigintValue);
  return new Uint8Array(buf);
}

export function toU64Bytes(value: NumericLike): Uint8Array {
  const bigintValue = asU64(value);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(bigintValue);
  return new Uint8Array(buf);
}

function coerceNumericLike(value: unknown): NumericLike {
  if (typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  const candidate = value as {
    toString?: () => string;
    toNumber?: () => number;
  } | null;
  if (candidate && typeof candidate.toString === "function") {
    return BigInt(candidate.toString());
  }
  if (candidate && typeof candidate.toNumber === "function") {
    return candidate.toNumber();
  }
  throw new Error("unsupported numeric value");
}

export function coerceBigInt(value: unknown): bigint {
  return toBigInt(coerceNumericLike(value));
}

/** Wire integer checks shared by hashing and Anchor encoding. */
export function asI64(value: NumericLike): bigint {
  const integer = toBigInt(value);
  if (integer < -(1n << 63n) || integer > (1n << 63n) - 1n) {
    throw new RangeError("value must fit in i64");
  }
  return integer;
}

export function asU64(value: NumericLike): bigint {
  const integer = toBigInt(value);
  if (integer < 0n) throw new RangeError("value must be non-negative");
  if (integer > (1n << 64n) - 1n) throw new RangeError("value must fit in u64");
  return integer;
}

/** Account identities accept PublicKey-like values, bytes, base58 or 32-byte hex. */
export function accountPublicKey(input: PublicKey | HashBytes): PublicKey {
  const keyBytes = publicKeyBytes(input);
  if (keyBytes) return new PublicKey(keyBytes);
  if (typeof input === "string") {
    try {
      return new PublicKey(input);
    } catch (_) {
      return new PublicKey(to32Bytes(input));
    }
  }
  return new PublicKey(to32Bytes(input as HashBytes));
}

function decodeHex(input: string): Buffer {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(input)) {
    throw new Error(
      "hex input must contain complete byte pairs without a prefix"
    );
  }
  return Buffer.from(input, "hex");
}

function validateByteArray(input: number[]): void {
  for (const byte of input) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error("byte array values must be integers between 0 and 255");
    }
  }
}
